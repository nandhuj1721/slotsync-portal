const { User, WeeklySchedule, AvailabilityOverride, Booking, NotificationLog } = require('../models');

const toMinutes = (timeStr) => {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const toTimeStr = (mins) => {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
};

// FR-4.2 & FR-4.3: Generate Date Slot Grid with Real-Time States
exports.getSlotsForDate = async (req, res) => {
  try {
    const { providerId, date } = req.query; // date: "YYYY-MM-DD"
    if (!providerId || !date) {
      return res.status(400).json({ error: 'providerId and date are required' });
    }

    const dayOfWeek = new Date(`${date}T00:00:00+05:30`).getDay(); // 0=Sun, 1=Mon...
    const schedules = await WeeklySchedule.find({ provider_id: providerId, day_of_week: dayOfWeek, is_active: true });
    if (!schedules.length) return res.json({ slots: [] });

    const overrides = await AvailabilityOverride.find({ provider_id: providerId, override_date: date, is_active: true });
    const providerBookings = await Booking.find({ provider_id: providerId, booking_date: date, status: 'BOOKED' });
    const studentBookings = await Booking.find({ student_id: req.user._id, booking_date: date, status: 'BOOKED' });

    const now = new Date();
    const slots = [];

    for (const sched of schedules) {
      let curr = toMinutes(sched.start_time);
      const end = toMinutes(sched.end_time);

      while (curr + sched.slot_duration <= end) {
        const slotStart = toTimeStr(curr);
        const slotEnd = toTimeStr(curr + sched.slot_duration);
        const slotStartTime = new Date(`${date}T${slotStart}:00+05:30`);

        let state = 'AVAILABLE';

        if (slotStartTime <= now) {
          state = 'EXPIRED';
        } else if (overrides.some(o => o.is_full_day || (curr < toMinutes(o.end_time) && (curr + sched.slot_duration) > toMinutes(o.start_time)))) {
          state = 'BLOCKED';
        } else {
          const existingBooking = providerBookings.find(b => b.start_time === slotStart);
          if (existingBooking) {
            state = existingBooking.student_id.equals(req.user._id) ? 'OWN_BOOKING' : 'BOOKED';
          } else if (studentBookings.some(b => curr < toMinutes(b.end_time) && (curr + sched.slot_duration) > toMinutes(b.start_time))) {
            state = 'CONFLICT_WITH_OWN_SCHEDULE';
          }
        }

        slots.push({ start_time: slotStart, end_time: slotEnd, duration: sched.slot_duration, state });
        curr += sched.slot_duration;
      }
    }
    res.json({ slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// FR-5.1 to FR-5.5: Direct Atomic Slot Booking
exports.createAtomicBooking = async (req, res) => {
  try {
    const { provider_id, booking_date, start_time, end_time, purpose } = req.body;
    if (!purpose || !purpose.trim()) {
      return res.status(400).json({ error: 'Visit purpose is mandatory' });
    }

    const student = await User.findById(req.user._id);
    const now = new Date();

    // 1. Cooldown Check (FR-10.3)
    if (student.restricted_until && student.restricted_until > now) {
      return res.status(403).json({ error: `Account in 7-day cooldown until ${student.restricted_until.toLocaleString()}` });
    }
    if (student.restricted_until && student.restricted_until <= now) {
      student.restricted_until = null;
      student.reliability_score = 70;
      await student.save();
    }

    // 2. Expiry & 7-Day Advance Horizon Check (FR-5.5, FR-7.1)
    const slotStartDateTime = new Date(`${booking_date}T${start_time}:00+05:30`);
    const maxHorizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (slotStartDateTime <= now || slotStartDateTime > maxHorizon) {
      return res.status(400).json({ error: 'Slot is expired or outside the 7-day advance booking window' });
    }

    // 3. Check Provider Temporary Overrides (FR-3.4)
    const newStart = toMinutes(start_time);
    const newEnd = toMinutes(end_time);
    const overrides = await AvailabilityOverride.find({ provider_id, override_date: booking_date, is_active: true });
    if (overrides.some(o => o.is_full_day || (newStart < toMinutes(o.end_time) && newEnd > toMinutes(o.start_time)))) {
      return res.status(409).json({ error: 'Slot is blocked by a temporary faculty override' });
    }

    // 4. Anti-Hoarding Quota Check (FR-5.5 & FR-10.3)
    const activeBookings = await Booking.find({ student_id: student._id, status: 'BOOKED' });
    const maxAllowed = student.reliability_score < 80 ? 1 : 3;
    if (activeBookings.length >= maxAllowed) {
      return res.status(409).json({ error: `Quota reached: max ${maxAllowed} active upcoming booking(s) allowed` });
    }
    if (activeBookings.some(b => b.provider_id.equals(provider_id) && b.booking_date === booking_date)) {
      return res.status(409).json({ error: 'You already hold an active booking with this provider on this date' });
    }

    // 5. Cross-Professor Interval Overlap Check (FR-5.3)
    const sameDayBookings = activeBookings.filter(b => b.booking_date === booking_date);
    const hasOverlap = sameDayBookings.some(b => newStart < toMinutes(b.end_time) && newEnd > toMinutes(b.start_time));
    if (hasOverlap) {
      return res.status(409).json({ error: 'Cross-professor overlap: You already have a booking during this time' });
    }

    // 6. Atomic Insert Protected by Unique Partial Index (FR-5.2)
    const booking = await Booking.create({
      student_id: student._id,
      provider_id,
      booking_date,
      start_time,
      end_time,
      purpose: purpose.trim(),
      status: 'BOOKED'
    });

    await NotificationLog.create({
      booking_id: booking._id,
      recipient_id: student._id,
      notification_type: 'CONFIRMATION',
      delivery_status: 'SENT'
    });

    return res.status(201).json({ message: 'Slot booked successfully (HTTP 201 Created)', booking });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'HTTP 409 Conflict: Slot was just reserved by another student' });
    }
    return res.status(500).json({ error: err.message });
  }
};

// FR-6.2 to FR-6.4: Student Cancellation with Isolated Slot Release & 30-Minute Cutoff
exports.cancelBookingByStudent = async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, student_id: req.user._id, status: 'BOOKED' });
    if (!booking) return res.status(404).json({ error: 'Active booking not found' });

    const slotStart = new Date(`${booking.booking_date}T${booking.start_time}:00+05:30`);
    const now = new Date();
    if (slotStart <= now) return res.status(400).json({ error: 'Cannot cancel an expired slot' });

    const diffMins = (slotStart - now) / (1000 * 60);
    const student = await User.findById(req.user._id);

    if (diffMins < 30) {
      booking.status = 'LATE_CANCELLATION';
      booking.score_delta = -10;
      student.reliability_score = Math.max(0, student.reliability_score - 10);
      if (student.reliability_score < 60) {
        student.restricted_until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      }
      await student.save();
    } else {
      booking.status = 'CANCELLED_STUDENT';
    }

    await booking.save();
    res.json({
      message: diffMins < 30
        ? 'Late cancellation (<30 mins): Slot released, -10 reliability points deducted'
        : 'Booking cancelled and isolated slot released without penalty',
      booking,
      reliability_score: student.reliability_score,
      restricted_until: student.restricted_until
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
