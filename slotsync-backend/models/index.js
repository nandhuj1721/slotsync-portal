const mongoose = require('mongoose');

// 1. Users Collection (Students, Faculty, HOD, Admin)
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  email: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['STUDENT', 'FACULTY', 'HOD', 'ADMIN'], required: true },
  reliability_score: { type: Number, default: 100, min: 0, max: 100 },
  restricted_until: { type: Date, default: null },
  is_active: { type: Boolean, default: true }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// 2. ProviderProfiles Collection (Faculty & HOD metadata)
const providerProfileSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  department: { type: String, required: true, index: true },
  office_location: { type: String, required: true },
  areas_of_help: { type: String, default: '' },
  is_hod: { type: Boolean, default: false }
});

// 3. WeeklySchedules Collection (Auto-Repeating Weekly Template)
const weeklyScheduleSchema = new mongoose.Schema({
  provider_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  day_of_week: { type: Number, min: 1, max: 6, required: true }, // 1=Mon ... 6=Sat
  start_time: { type: String, required: true }, // "HH:mm"
  end_time: { type: String, required: true },   // "HH:mm"
  slot_duration: { type: Number, enum: [5, 10, 15, 30], required: true },
  is_active: { type: Boolean, default: true }
});

// 4. AvailabilityOverrides Collection (Temporary Date-Specific Blocks)
const availabilityOverrideSchema = new mongoose.Schema({
  provider_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  override_date: { type: String, required: true }, // "YYYY-MM-DD"
  start_time: { type: String, default: '00:00' },
  end_time: { type: String, default: '23:59' },
  is_full_day: { type: Boolean, default: false },
  reason: { type: String, default: 'Unexpected commitment' },
  is_active: { type: Boolean, default: true }
});

// 5. Bookings Collection (Unique Partial Index for Atomic Concurrency)
const bookingSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  provider_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  booking_date: { type: String, required: true }, // "YYYY-MM-DD"
  start_time: { type: String, required: true },   // "HH:mm"
  end_time: { type: String, required: true },     // "HH:mm"
  purpose: { type: String, required: true },
  status: {
    type: String,
    enum: ['BOOKED', 'CANCELLED_STUDENT', 'LATE_CANCELLATION', 'CANCELLED_FACULTY', 'COMPLETED'],
    default: 'BOOKED'
  },
  attendance_status: {
    type: String,
    enum: ['PENDING', 'ON_TIME', 'LATE', 'NO_SHOW'],
    default: 'PENDING'
  },
  score_delta: { type: Number, default: 0 }
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// FR-5.2: Unique Partial Index ensuring First-Commit-Wins on active bookings
bookingSchema.index(
  { provider_id: 1, booking_date: 1, start_time: 1 },
  { unique: true, partialFilterExpression: { status: 'BOOKED' } }
);

// 6. NotificationLogs Collection (Fault-tolerant email audit)
const notificationLogSchema = new mongoose.Schema({
  booking_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  recipient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  notification_type: { type: String, enum: ['CONFIRMATION', 'CANCELLATION', 'PENALTY_ALERT'], required: true },
  delivery_status: { type: String, enum: ['SENT', 'FAILED'], required: true },
  error_message: { type: String, default: null },
  sent_at: { type: Date, default: Date.now }
});

module.exports = {
  User: mongoose.model('User', userSchema),
  ProviderProfile: mongoose.model('ProviderProfile', providerProfileSchema),
  WeeklySchedule: mongoose.model('WeeklySchedule', weeklyScheduleSchema),
  AvailabilityOverride: mongoose.model('AvailabilityOverride', availabilityOverrideSchema),
  Booking: mongoose.model('Booking', bookingSchema),
  NotificationLog: mongoose.model('NotificationLog', notificationLogSchema)
};
