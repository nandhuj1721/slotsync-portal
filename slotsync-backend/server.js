require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const {
  User,
  ProviderProfile,
  WeeklySchedule,
  AvailabilityOverride,
  Booking,
  NotificationLog
} = require('./models');
const { authenticate, authorizeRoles } = require('./middleware/auth');
const bookingController = require('./controllers/bookingController');

const app = express();
app.use(cors());
app.use(express.json());

const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// 1. Auth: Register (@nitc.ac.in enforced)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, department, office_location, areas_of_help } = req.body;
    if (!email.endsWith(`@${process.env.ALLOWED_DOMAIN}`)) {
      return res.status(400).json({ error: `Only @${process.env.ALLOWED_DOMAIN} emails are permitted` });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password_hash, role });

    if (role === 'FACULTY' || role === 'HOD') {
      await ProviderProfile.create({
        user_id: user._id,
        department: department || 'CSE',
        office_location: office_location || 'CSED Cabin',
        areas_of_help: areas_of_help || 'Academic Consultation',
        is_hod: role === 'HOD'
      });
    }
    res.status(201).json({ message: 'User registered', user_id: user._id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. Auth: Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, is_active: true });
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials or deactivated account' });
    }
    const token = jwt.sign({ user_id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        reliability_score: user.reliability_score,
        restricted_until: user.restricted_until
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Student Search: Find Faculty by Name, Department, or HOD (FR-4.1)
app.get('/api/providers', authenticate, async (req, res) => {
  try {
    const { search, department, is_hod } = req.query;
    const profileFilter = {};
    if (department) profileFilter.department = department;
    if (is_hod === 'true') profileFilter.is_hod = true;

    const profiles = await ProviderProfile.find(profileFilter).populate('user_id', 'name email role is_active');
    const result = profiles.filter(p => {
      if (!p.user_id || !p.user_id.is_active) return false;
      if (search && !p.user_id.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Provider: Configure Recurring Weekly Schedule (FR-2.2 & FR-2.4)
app.post('/api/schedules', authenticate, authorizeRoles('FACULTY', 'HOD'), async (req, res) => {
  try {
    const { day_of_week, start_time, end_time, slot_duration } = req.body;
    if (toMinutes(end_time) - toMinutes(start_time) < Number(slot_duration)) {
      return res.status(400).json({ error: 'End time must be after start time by at least one slot duration' });
    }
    const schedule = await WeeklySchedule.create({
      provider_id: req.user._id,
      day_of_week: Number(day_of_week),
      start_time,
      end_time,
      slot_duration: Number(slot_duration)
    });
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/schedules/my', authenticate, authorizeRoles('FACULTY', 'HOD'), async (req, res) => {
  const schedules = await WeeklySchedule.find({ provider_id: req.user._id, is_active: true }).sort({ day_of_week: 1 });
  res.json(schedules);
});

// 5. Provider: Apply & Restore Temporary Availability Overrides (FR-3.1 to FR-3.5)
app.post('/api/overrides', authenticate, authorizeRoles('FACULTY', 'HOD'), async (req, res) => {
  try {
    const { override_date, start_time, end_time, is_full_day, reason } = req.body;
    const override = await AvailabilityOverride.create({
      provider_id: req.user._id,
      override_date,
      start_time: is_full_day ? '00:00' : start_time,
      end_time: is_full_day ? '23:59' : end_time,
      is_full_day: Boolean(is_full_day),
      reason: reason || 'Faculty unavailable'
    });

    const activeBookings = await Booking.find({
      provider_id: req.user._id,
      booking_date: override_date,
      status: 'BOOKED'
    });

    const bStart = toMinutes(override.start_time);
    const bEnd = toMinutes(override.end_time);
    let cancelledCount = 0;

    for (const b of activeBookings) {
      if (override.is_full_day || (toMinutes(b.start_time) < bEnd && toMinutes(b.end_time) > bStart)) {
        b.status = 'CANCELLED_FACULTY';
        await b.save();
        cancelledCount++;
        await NotificationLog.create({
          booking_id: b._id,
          recipient_id: b.student_id,
          notification_type: 'CANCELLATION',
          delivery_status: 'SENT'
        });
      }
    }
    res.status(201).json({ override, cancelledBookings: cancelledCount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/overrides/my', authenticate, authorizeRoles('FACULTY', 'HOD'), async (req, res) => {
  const overrides = await AvailabilityOverride.find({ provider_id: req.user._id, is_active: true });
  res.json(overrides);
});

app.delete('/api/overrides/:id', authenticate, authorizeRoles('FACULTY', 'HOD'), async (req, res) => {
  await AvailabilityOverride.findOneAndUpdate({ _id: req.params.id, provider_id: req.user._id }, { is_active: false });
  res.json({ message: 'Temporary block removed and availability restored' });
});

// 6. Student & Provider Dashboards (FR-8.1 to FR-8.3)
app.get('/api/bookings/my', authenticate, async (req, res) => {
  try {
    const filter = req.user.role === 'STUDENT'
      ? { student_id: req.user._id }
      : { provider_id: req.user._id };
    const bookings = await Booking.find(filter)
      .populate('student_id', 'name email reliability_score')
      .populate('provider_id', 'name email')
      .sort({ booking_date: 1, start_time: 1 });
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Provider: Mark Student Attendance & Update Reliability Score (FR-10.1 to FR-10.3)
app.patch('/api/bookings/:id/attendance', authenticate, authorizeRoles('FACULTY', 'HOD'), async (req, res) => {
  try {
    const { attendance_status } = req.body;
    const booking = await Booking.findOne({ _id: req.params.id, provider_id: req.user._id });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const deltaMap = { ON_TIME: 2, LATE: -10, NO_SHOW: -25 };
    const delta = deltaMap[attendance_status] || 0;

    booking.attendance_status = attendance_status;
    booking.status = 'COMPLETED';
    booking.score_delta = delta;
    await booking.save();

    const student = await User.findById(booking.student_id);
    student.reliability_score = Math.min(100, Math.max(0, student.reliability_score + delta));

    if (student.reliability_score < 60) {
      student.restricted_until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await NotificationLog.create({
        booking_id: booking._id,
        recipient_id: student._id,
        notification_type: 'PENALTY_ALERT',
        delivery_status: 'SENT'
      });
    }
    await student.save();
    res.json({ booking, updated_student_score: student.reliability_score, restricted_until: student.restricted_until });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Admin Routes: Users, Cooldown Override & Logs (FR-9.1 to FR-9.3, FR-10.4)
app.get('/api/admin/users', authenticate, authorizeRoles('ADMIN'), async (req, res) => {
  const users = await User.find().select('-password_hash');
  res.json(users);
});

app.patch('/api/admin/users/:id/reset-cooldown', authenticate, authorizeRoles('ADMIN'), async (req, res) => {
  const student = await User.findByIdAndUpdate(
    req.params.id,
    { reliability_score: 80, restricted_until: null },
    { new: true }
  );
  res.json({ message: 'Cooldown cleared and score restored to 80', student });
});

app.patch('/api/admin/users/:id/toggle-active', authenticate, authorizeRoles('ADMIN'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.is_active = !user.is_active;
  await user.save();
  res.json({ message: `Account ${user.is_active ? 'activated' : 'deactivated'}`, user });
});

app.get('/api/admin/logs', authenticate, authorizeRoles('ADMIN'), async (req, res) => {
  const logs = await NotificationLog.find().populate('recipient_id', 'name email').sort({ sent_at: -1 });
  res.json(logs);
});

// 9. Slot & Booking Routes
app.get('/api/slots', authenticate, bookingController.getSlotsForDate);
app.post('/api/bookings', authenticate, authorizeRoles('STUDENT'), bookingController.createAtomicBooking);
app.patch('/api/bookings/:id/cancel', authenticate, authorizeRoles('STUDENT'), bookingController.cancelBookingByStudent);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB & Unique Indexes synced');
    app.listen(process.env.PORT || 5000, () => console.log(`SlotSync API running on port ${process.env.PORT || 5000}`));
  })
  .catch(err => console.error('Database connection error:', err));
