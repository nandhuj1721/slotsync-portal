require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User, ProviderProfile, WeeklySchedule } = require('./models');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await mongoose.connection.db.dropDatabase();
    const hash = await bcrypt.hash('password123', 10);

    const student = await User.create({ name: 'Nandhu J', email: 'student@nitc.ac.in', password_hash: hash, role: 'STUDENT' });
    const faculty = await User.create({ name: 'Dr. Arun Raj', email: 'faculty@nitc.ac.in', password_hash: hash, role: 'FACULTY' });
    const hod = await User.create({ name: 'Dr. CSE HOD', email: 'hod@nitc.ac.in', password_hash: hash, role: 'HOD' });
    await User.create({ name: 'System Admin', email: 'admin@nitc.ac.in', password_hash: hash, role: 'ADMIN' });

    await ProviderProfile.create([
      { user_id: faculty._id, department: 'CSE', office_location: 'CSED Cabin 204', areas_of_help: 'Project Guidance & Networks', is_hod: false },
      { user_id: hod._id, department: 'CSE', office_location: 'HOD Chamber 101', areas_of_help: 'Department Approvals & Signatures', is_hod: true }
    ]);

    for (let day = 1; day <= 6; day++) {
      await WeeklySchedule.create([
        { provider_id: faculty._id, day_of_week: day, start_time: '10:00', end_time: '12:00', slot_duration: 15 },
        { provider_id: hod._id, day_of_week: day, start_time: '14:00', end_time: '16:00', slot_duration: 10 }
      ]);
    }
    console.log('Seed complete! Accounts created with password: password123');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
})();
