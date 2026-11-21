import React, { useState, useEffect } from 'react';
import api from './api';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('slotsync_user') || 'null'));
  const [email, setEmail] = useState('student@nitc.ac.in');
  const [password, setPassword] = useState('password123');
  const [message, setMessage] = useState('');

  // Student State
  const [providers, setProviders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [hodOnly, setHodOnly] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (d.getDay() === 6 ? 2 : 1));
    return d.toISOString().split('T')[0];
  });
  const [slots, setSlots] = useState([]);
  const [purpose, setPurpose] = useState('');
  const [myBookings, setMyBookings] = useState([]);

  // Provider State
  const [mySchedules, setMySchedules] = useState([]);
  const [myOverrides, setMyOverrides] = useState([]);
  const [schedDay, setSchedDay] = useState(1);
  const [schedStart, setSchedStart] = useState('15:00');
  const [schedEnd, setSchedEnd] = useState('16:00');
  const [schedDuration, setSchedDuration] = useState(15);
  const [overrideDate, setOverrideDate] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Admin State
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLogs, setAdminLogs] = useState([]);

  const login = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('slotsync_token', data.token);
      localStorage.setItem('slotsync_user', JSON.stringify(data.user));
      setUser(data.user);
      setMessage('');
    } catch (err) {
      setMessage(err.response?.data?.error || 'Login failed');
    }
  };

  const logout = () => {
    localStorage.clear();
    setUser(null);
    setSelectedProvider(null);
    setMessage('');
  };

  const loadData = async () => {
    if (!user) return;
    try {
      if (user.role === 'STUDENT') {
        const params = new URLSearchParams();
        if (searchQuery) params.append('search', searchQuery);
        if (hodOnly) params.append('is_hod', 'true');
        const pRes = await api.get(`/providers?${params.toString()}`);
        setProviders(pRes.data);
        const bRes = await api.get('/bookings/my');
        setMyBookings(bRes.data);
      } else if (user.role === 'FACULTY' || user.role === 'HOD') {
        const [bRes, sRes, oRes] = await Promise.all([
          api.get('/bookings/my'),
          api.get('/schedules/my'),
          api.get('/overrides/my')
        ]);
        setMyBookings(bRes.data);
        setMySchedules(sRes.data);
        setMyOverrides(oRes.data);
      } else if (user.role === 'ADMIN') {
        const [uRes, lRes] = await Promise.all([
          api.get('/admin/users'),
          api.get('/admin/logs')
        ]);
        setAdminUsers(uRes.data);
        setAdminLogs(lRes.data);
      }
    } catch (err) {
      setMessage(err.response?.data?.error || 'Error loading data');
    }
  };

  useEffect(() => { loadData(); }, [user, searchQuery, hodOnly]);

  useEffect(() => {
    if (selectedProvider && selectedDate && user?.role === 'STUDENT') {
      api.get(`/slots?providerId=${selectedProvider.user_id._id}&date=${selectedDate}`)
        .then(res => setSlots(res.data.slots))
        .catch(() => setSlots([]));
    }
  }, [selectedProvider, selectedDate, myBookings]);

  const bookSlot = async (slot) => {
    if (!purpose.trim()) return setMessage('Please enter a mandatory visit purpose before booking.');
    try {
      const { data } = await api.post('/bookings', {
        provider_id: selectedProvider.user_id._id,
        booking_date: selectedDate,
        start_time: slot.start_time,
        end_time: slot.end_time,
        purpose
      });
      setMessage(data.message);
      setPurpose('');
      loadData();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Booking failed');
    }
  };

  const cancelBooking = async (id) => {
    try {
      const { data } = await api.patch(`/bookings/${id}/cancel`);
      setMessage(data.message);
      const updatedUser = { ...user, reliability_score: data.reliability_score, restricted_until: data.restricted_until };
      localStorage.setItem('slotsync_user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      loadData();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Cancel failed');
    }
  };

  const markAttendance = async (id, status) => {
    await api.patch(`/bookings/${id}/attendance`, { attendance_status: status });
    setMessage(`Marked student attendance as ${status}`);
    loadData();
  };

  const addWeeklySchedule = async (e) => {
    e.preventDefault();
    try {
      await api.post('/schedules', {
        day_of_week: Number(schedDay),
        start_time: schedStart,
        end_time: schedEnd,
        slot_duration: Number(schedDuration)
      });
      setMessage('Recurring weekly schedule saved.');
      loadData();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to add schedule');
    }
  };

  const applyFullDayBlock = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/overrides', {
        override_date: overrideDate,
        is_full_day: true,
        reason: overrideReason
      });
      setMessage(`Full-day block applied. Auto-cancelled ${data.cancelledBookings} overlapping booking(s).`);
      setOverrideDate('');
      setOverrideReason('');
      loadData();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to apply block');
    }
  };

  const restoreBlock = async (id) => {
    await api.delete(`/overrides/${id}`);
    setMessage('Temporary block removed and availability restored.');
    loadData();
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <form onSubmit={login} className="bg-white p-8 rounded-xl shadow-md w-full max-w-md space-y-4">
          <h1 className="text-2xl font-bold text-slate-800">SlotSync Portal (@nitc.ac.in)</h1>
          {message && <div className="p-3 bg-red-100 text-red-700 rounded text-sm">{message}</div>}
          <div>
            <label className="block text-sm font-medium">Institutional Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} className="w-full border p-2 rounded mt-1" />
          </div>
          <div>
            <label className="block text-sm font-medium">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border p-2 rounded mt-1" />
          </div>
          <button className="w-full bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700">Sign In</button>
          <div className="text-xs text-slate-500 space-y-1 pt-2 border-t">
            <p className="font-semibold">Quick Demo Accounts (password: password123):</p>
            <div className="flex gap-2 flex-wrap">
              {['student@nitc.ac.in', 'faculty@nitc.ac.in', 'hod@nitc.ac.in', 'admin@nitc.ac.in'].map(acc => (
                <button key={acc} type="button" onClick={() => setEmail(acc)} className="underline text-blue-600">{acc}</button>
              ))}
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap justify-between items-center gap-4 bg-white p-4 rounded-xl shadow-sm">
        <div>
          <h1 className="text-xl font-bold">SlotSync — {user.role} Dashboard</h1>
          <p className="text-sm text-slate-500">{user.name} ({user.email})</p>
        </div>
        <div className="flex items-center gap-4">
          {user.role === 'STUDENT' && (
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${user.reliability_score >= 80 ? 'bg-green-100 text-green-800' : user.reliability_score >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
              Reliability Score: {user.reliability_score}/100
            </span>
          )}
          <button onClick={logout} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm font-medium">Logout</button>
        </div>
      </header>

      {message && <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg text-sm">{message}</div>}

      {/* STUDENT PORTAL */}
      {user.role === 'STUDENT' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white p-5 rounded-xl shadow-sm space-y-4">
            <h2 className="font-bold text-lg">1. Search Faculty / HOD & Pick Date</h2>
            <div className="flex gap-2 items-center">
              <input
                placeholder="Search faculty name..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="border p-2 rounded flex-1 text-sm"
              />
              <label className="flex items-center gap-1 text-xs font-medium">
                <input type="checkbox" checked={hodOnly} onChange={e => setHodOnly(e.target.checked)} />
                HOD Only
              </label>
            </div>
            <div className="space-y-2">
              {providers.map(p => (
                <div key={p._id} onClick={() => setSelectedProvider(p)} className={`p-3 border rounded-lg cursor-pointer ${selectedProvider?._id === p._id ? 'border-blue-600 bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <div className="font-semibold">{p.user_id.name} {p.is_hod && <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded ml-2">HOD</span>}</div>
                  <div className="text-xs text-slate-600">{p.department} • Cabin: {p.office_location} • {p.areas_of_help}</div>
                </div>
              ))}
            </div>
            {selectedProvider && (
              <div className="space-y-3 pt-3 border-t">
                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border p-2 rounded w-full text-sm" />
                <input placeholder="Enter mandatory purpose of visit..." value={purpose} onChange={e => setPurpose(e.target.value)} className="border p-2 rounded w-full text-sm" />
                {slots.length === 0 ? (
                  <p className="text-xs text-slate-500">No consultation slots scheduled for this day (Note: Sunday has no schedule).</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {slots.map(s => (
                      <button
                        key={s.start_time}
                        disabled={s.state !== 'AVAILABLE'}
                        onClick={() => bookSlot(s)}
                        className={`p-2 rounded text-xs font-semibold border ${
                          s.state === 'AVAILABLE' ? 'bg-emerald-50 border-emerald-400 text-emerald-800 hover:bg-emerald-100' :
                          s.state === 'OWN_BOOKING' ? 'bg-blue-100 border-blue-400 text-blue-800' :
                          s.state === 'CONFLICT_WITH_OWN_SCHEDULE' ? 'bg-amber-50 border-amber-300 text-amber-700' :
                          'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {s.start_time} - {s.end_time}<br/>({s.state})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm space-y-4">
            <h2 className="font-bold text-lg">2. My Appointments</h2>
            {myBookings.length === 0 && <p className="text-sm text-slate-500">No appointments booked yet.</p>}
            {myBookings.map(b => (
              <div key={b._id} className="p-3 border rounded-lg flex justify-between items-center gap-2">
                <div>
                  <div className="font-semibold text-sm">{b.provider_id?.name} — {b.booking_date} ({b.start_time}-{b.end_time})</div>
                  <div className="text-xs text-slate-600">Purpose: {b.purpose} • Status: <b>{b.status}</b> • Attendance: {b.attendance_status}</div>
                </div>
                {b.status === 'BOOKED' && (
                  <button onClick={() => cancelBooking(b._id)} className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold">Cancel</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FACULTY & HOD PORTAL */}
      {(user.role === 'FACULTY' || user.role === 'HOD') && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white p-5 rounded-xl shadow-sm space-y-4">
            <h2 className="font-bold text-lg">Student Appointments & Attendance Marking</h2>
            {myBookings.length === 0 && <p className="text-sm text-slate-500">No student bookings yet.</p>}
            {myBookings.map(b => (
              <div key={b._id} className="p-3 border rounded-lg space-y-2">
                <div className="font-semibold text-sm">{b.student_id?.name} ({b.student_id?.email})</div>
                <div className="text-xs text-slate-600">{b.booking_date} | {b.start_time}-{b.end_time} | Purpose: {b.purpose} | Status: <b>{b.status}</b></div>
                {b.status === 'BOOKED' && (
                  <div className="flex gap-2">
                    <button onClick={() => markAttendance(b._id, 'ON_TIME')} className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">On-Time (+2)</button>
                    <button onClick={() => markAttendance(b._id, 'LATE')} className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-medium">Late (-10)</button>
                    <button onClick={() => markAttendance(b._id, 'NO_SHOW')} className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">No-Show (-25)</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-6">
            <form onSubmit={addWeeklySchedule} className="bg-white p-5 rounded-xl shadow-sm space-y-3">
              <h2 className="font-bold text-lg">Add Recurring Weekly Schedule</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <select value={schedDay} onChange={e => setSchedDay(e.target.value)} className="border p-2 rounded">
                  {[1,2,3,4,5,6].map(d => <option key={d} value={d}>{DAYS[d]}</option>)}
                </select>
                <select value={schedDuration} onChange={e => setSchedDuration(e.target.value)} className="border p-2 rounded">
                  {[5,10,15,30].map(m => <option key={m} value={m}>{m} min slots</option>)}
                </select>
                <input type="time" value={schedStart} onChange={e => setSchedStart(e.target.value)} className="border p-2 rounded" />
                <input type="time" value={schedEnd} onChange={e => setSchedEnd(e.target.value)} className="border p-2 rounded" />
              </div>
              <button className="bg-blue-600 text-white px-4 py-2 rounded font-semibold text-xs">Save Weekly Slot Window</button>
              <div className="text-xs text-slate-600 pt-2 border-t space-y-1">
                <p className="font-semibold">Active Weekly Windows ({mySchedules.length}):</p>
                {mySchedules.map(s => (
                  <div key={s._id}>{DAYS[s.day_of_week]}: {s.start_time}–{s.end_time} ({s.slot_duration}m)</div>
                ))}
              </div>
            </form>

            <form onSubmit={applyFullDayBlock} className="bg-white p-5 rounded-xl shadow-sm space-y-3">
              <h2 className="font-bold text-lg">Temporary Full-Day Block (Override)</h2>
              <input type="date" required value={overrideDate} onChange={e => setOverrideDate(e.target.value)} className="border p-2 rounded w-full text-sm" />
              <input placeholder="Reason (e.g., Department Meeting)" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className="border p-2 rounded w-full text-sm" />
              <button className="bg-amber-600 text-white px-4 py-2 rounded font-semibold text-xs">Block Date & Cancel Overlapping</button>
              {myOverrides.length > 0 && (
                <div className="pt-2 border-t space-y-1 text-xs">
                  {myOverrides.map(o => (
                    <div key={o._id} className="flex justify-between items-center">
                      <span>Blocked: <b>{o.override_date}</b> ({o.reason})</span>
                      <button type="button" onClick={() => restoreBlock(o._id)} className="text-blue-600 underline">Restore</button>
                    </div>
                  ))}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ADMIN CONSOLE */}
      {user.role === 'ADMIN' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white p-5 rounded-xl shadow-sm space-y-4">
            <h2 className="font-bold text-lg">Users & Cooldown Override</h2>
            {adminUsers.map(u => (
              <div key={u._id} className="p-3 border rounded flex flex-wrap justify-between items-center gap-2 text-sm">
                <span><b>{u.name}</b> ({u.email}) — {u.role} | Score: {u.reliability_score}</span>
                <div className="flex gap-2">
                  {u.role === 'STUDENT' && (
                    <button onClick={async () => { await api.patch(`/admin/users/${u._id}/reset-cooldown`); loadData(); }} className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs font-semibold">
                      Reset Score (80)
                    </button>
                  )}
                  <button onClick={async () => { await api.patch(`/admin/users/${u._id}/toggle-active`); loadData(); }} className="px-2 py-1 bg-slate-200 text-slate-700 rounded text-xs">
                    {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm space-y-4">
            <h2 className="font-bold text-lg">Notification Audit Log</h2>
            {adminLogs.length === 0 && <p className="text-sm text-slate-500">No notification logs recorded yet.</p>}
            {adminLogs.map(log => (
              <div key={log._id} className="p-2 border rounded text-xs text-slate-600">
                <b>{log.notification_type}</b> to {log.recipient_id?.email} — <b>{log.delivery_status}</b> ({new Date(log.sent_at).toLocaleString()})
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
