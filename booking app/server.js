const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");
const APP_VERSION = "1.3.0";
const liveClients = new Set();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function readData() {
  try {
    return {
      instruments: ["DJ", "Drums", "Guitar", "Piano", "Singing", "Violin"],
      teachers: [],
      users: [],
      bookings: [],
      payments: [],
      donations: [],
      suggestions: [],
      ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
    };
  } catch {
    return {
      instruments: ["DJ", "Drums", "Guitar", "Piano", "Singing", "Violin"],
      teachers: [],
      users: [],
      bookings: [],
      payments: [],
      donations: [],
      suggestions: []
    };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function notifyDataChange(type, payload = {}) {
  const message = `event: soundslot-update\ndata: ${JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    ...payload
  })}\n\n`;
  liveClients.forEach(client => client.write(message));
}

function sortedUniqueInstruments(items) {
  return [...new Set(items.map(item => String(item).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function paymentSplit(amount) {
  const gross = money(amount);
  const appFeeRate = 0.015;
  const appFee = money(gross * appFeeRate);
  return {
    gross,
    appFeeRate,
    appFee,
    instructorPayout: money(gross - appFee)
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function safePath(urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const filePath = path.join(ROOT, cleanPath);
  return filePath.startsWith(ROOT) ? filePath : null;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      app: "SoundSlot",
      version: APP_VERSION,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (url.pathname === "/api/events" && request.method === "GET") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    response.write(`event: soundslot-update\ndata: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);
    liveClients.add(response);
    request.on("close", () => liveClients.delete(response));
    return;
  }

  if (url.pathname === "/api/instruments" && request.method === "GET") {
    const data = readData();
    data.instruments = sortedUniqueInstruments(data.instruments || []);
    sendJson(response, 200, { instruments: data.instruments });
    return;
  }

  if (url.pathname === "/api/users" && request.method === "GET") {
    const data = readData();
    const users = (data.users || []).map(({ password, ...user }) => user);
    sendJson(response, 200, { users });
    return;
  }

  if (url.pathname === "/api/users" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request));
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "").trim();
      if (!name || !email || !password) {
        sendJson(response, 400, { error: "Name, email, and password are required" });
        return;
      }

      const data = readData();
      const existing = (data.users || []).find(user => user.email.toLowerCase() === email);
      if (existing && existing.id !== body.id) {
        sendJson(response, 409, { error: "An account with this email already exists" });
        return;
      }

      const user = {
        id: body.id || `user-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        email,
        password,
        role: "student",
        phone: body.phone || "",
        createdAt: body.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.users = [...(data.users || []).filter(item => item.id !== user.id), user];
      writeData(data);
      const { password: _password, ...safeUser } = user;
      notifyDataChange("user-created", { userId: safeUser.id });
      sendJson(response, 201, { user: safeUser, users: data.users.map(({ password, ...item }) => item) });
    } catch {
      sendJson(response, 400, { error: "Invalid user account request" });
    }
    return;
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request));
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "").trim();
      const data = readData();
      const user = (data.users || []).find(item => item.email.toLowerCase() === email && item.password === password);
      if (!user) {
        sendJson(response, 401, { error: "Email or password is incorrect" });
        return;
      }
      user.lastLoginAt = new Date().toISOString();
      user.updatedAt = new Date().toISOString();
      writeData(data);
      notifyDataChange("user-login", { userId: user.id });
      const { password: _password, ...safeUser } = user;
      sendJson(response, 200, { user: safeUser });
    } catch {
      sendJson(response, 400, { error: "Invalid login request" });
    }
    return;
  }

  if (url.pathname.startsWith("/api/users/") && request.method === "DELETE") {
    try {
      const userId = decodeURIComponent(url.pathname.split("/").pop());
      const data = readData();
      const existing = (data.users || []).find(item => String(item.id) === userId);
      if (!existing) {
        sendJson(response, 404, { error: "User account not found" });
        return;
      }

      data.users = (data.users || []).filter(item => String(item.id) !== userId);
      data.bookings = (data.bookings || []).map(booking => {
        if (String(booking.userId) !== userId || ["cancelled", "declined", "paid"].includes(booking.status)) {
          return booking;
        }
        return {
          ...booking,
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          cancellationReason: "User account deleted"
        };
      });
      writeData(data);
      notifyDataChange("user-deleted", { userId });
      sendJson(response, 200, {
        deletedUserId: userId,
        users: data.users.map(({ password, ...user }) => user),
        bookings: data.bookings
      });
    } catch {
      sendJson(response, 400, { error: "Invalid user delete request" });
    }
    return;
  }

  if (url.pathname === "/api/instruments" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request));
      const instrument = String(body.instrument || "").trim();
      if (!instrument) {
        sendJson(response, 400, { error: "Instrument is required" });
        return;
      }

      const data = readData();
      data.instruments = sortedUniqueInstruments([...(data.instruments || []), instrument]);
      writeData(data);
      notifyDataChange("instrument-created", { instrument });
      sendJson(response, 201, { instruments: data.instruments });
    } catch {
      sendJson(response, 400, { error: "Invalid instrument request" });
    }
    return;
  }

  if (url.pathname === "/api/teachers" && request.method === "GET") {
    const data = readData();
    sendJson(response, 200, { teachers: data.teachers || [] });
    return;
  }

  if (url.pathname === "/api/teachers" && request.method === "POST") {
    try {
      const profile = JSON.parse(await readRequestBody(request));
      if (!profile.name || !profile.email || !Array.isArray(profile.instruments) || profile.instruments.length === 0) {
        sendJson(response, 400, { error: "Teacher name, email, and instruments are required" });
        return;
      }

      const data = readData();
      const teacher = {
        ...profile,
        id: profile.id || `teacher-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        instrument: profile.instruments[0],
        instruments: sortedUniqueInstruments(profile.instruments),
        rating: Number(profile.rating || 0),
        reviews: Number(profile.reviews || 0),
        likes: Number(profile.likes || 0),
        reviewsList: profile.reviewsList || [],
        createdAt: profile.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.teachers = [...(data.teachers || []).filter(item => item.id !== teacher.id), teacher];
      data.instruments = sortedUniqueInstruments([...(data.instruments || []), ...teacher.instruments]);
      writeData(data);
      notifyDataChange("teacher-saved", { teacherId: teacher.id });
      sendJson(response, 201, { teacher, teachers: data.teachers });
    } catch {
      sendJson(response, 400, { error: "Invalid teacher profile" });
    }
    return;
  }

  if (url.pathname.startsWith("/api/teachers/") && request.method === "DELETE") {
    try {
      const teacherId = decodeURIComponent(url.pathname.split("/").pop());
      const data = readData();
      const existing = (data.teachers || []).find(item => String(item.id) === teacherId);
      if (!existing) {
        sendJson(response, 404, { error: "Teacher profile not found" });
        return;
      }

      data.teachers = (data.teachers || []).filter(item => String(item.id) !== teacherId);
      data.bookings = (data.bookings || []).map(booking => {
        if (String(booking.teacherId) !== teacherId || ["cancelled", "declined", "paid"].includes(booking.status)) {
          return booking;
        }
        return {
          ...booking,
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          cancellationReason: "Instructor profile deleted"
        };
      });
      writeData(data);
      notifyDataChange("teacher-deleted", { teacherId });
      sendJson(response, 200, { deletedTeacherId: teacherId, teachers: data.teachers, bookings: data.bookings });
    } catch {
      sendJson(response, 400, { error: "Invalid teacher delete request" });
    }
    return;
  }

  if (url.pathname === "/api/bookings" && request.method === "GET") {
    const data = readData();
    sendJson(response, 200, { bookings: data.bookings || [] });
    return;
  }

  if (url.pathname === "/api/bookings" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request));
      if (!body.teacherId || !(body.studentEmail || body.email) || !body.slotId) {
        sendJson(response, 400, { error: "Teacher, student email, and slot are required" });
        return;
      }

      const data = readData();
      const studentEmail = String(body.studentEmail || body.email || "").trim().toLowerCase();
      const user = (data.users || []).find(item => item.email.toLowerCase() === studentEmail);
      const booking = {
        ...body,
        id: body.id || `booking-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        userId: body.userId || user?.id || "",
        studentEmail,
        email: studentEmail,
        status: body.status || "pending",
        requestedAt: body.requestedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      data.bookings = [...(data.bookings || []).filter(item => item.id !== booking.id), booking];
      writeData(data);
      notifyDataChange("booking-created", { bookingId: booking.id, teacherId: booking.teacherId });
      sendJson(response, 201, { booking, bookings: data.bookings });
    } catch {
      sendJson(response, 400, { error: "Invalid booking request" });
    }
    return;
  }

  if (url.pathname.startsWith("/api/bookings/") && request.method === "PATCH") {
    try {
      const bookingId = decodeURIComponent(url.pathname.split("/").pop());
      const body = JSON.parse(await readRequestBody(request));
      const data = readData();
      const booking = (data.bookings || []).find(item => item.id === bookingId);
      if (!booking) {
        sendJson(response, 404, { error: "Booking not found" });
        return;
      }

      Object.assign(booking, body, { updatedAt: new Date().toISOString() });
      writeData(data);
      notifyDataChange("booking-updated", { bookingId });
      sendJson(response, 200, { booking, bookings: data.bookings });
    } catch {
      sendJson(response, 400, { error: "Invalid booking update" });
    }
    return;
  }

  if (url.pathname === "/api/payments" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request));
      const split = paymentSplit(body.amount);
      if (split.gross <= 0) {
        sendJson(response, 400, { error: "Payment amount must be greater than zero" });
        return;
      }

      const data = readData();
      const payment = {
        id: `payment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        bookingId: body.bookingId,
        teacher: body.teacher,
        teacherEmail: body.teacherEmail,
        studentName: body.studentName,
        studentEmail: body.studentEmail,
        instrument: body.instrument,
        slot: body.slot,
        status: "paid",
        ...split,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      const booking = (data.bookings || []).find(item => item.id === payment.bookingId);
      if (booking) {
        Object.assign(booking, {
          status: "paid",
          paymentId: payment.id,
          appFee: payment.appFee,
          instructorPayout: payment.instructorPayout,
          paidAt: payment.completedAt,
          updatedAt: payment.completedAt
        });
      }
      data.payments = [...(data.payments || []), payment];
      writeData(data);
      notifyDataChange("payment-recorded", { paymentId: payment.id, bookingId: payment.bookingId });
      sendJson(response, 201, { payment, booking });
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Invalid or failed payment request" });
    }
    return;
  }

  if (url.pathname === "/api/donations" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request));
      const amount = money(body.amount);
      if (amount <= 0) {
        sendJson(response, 400, { error: "Donation amount must be greater than zero" });
        return;
      }

      const data = readData();
      const donation = {
        id: `donation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: body.name || "Anonymous",
        email: body.email || "",
        amount,
        message: body.message || "",
        status: "recorded",
        createdAt: new Date().toISOString()
      };
      data.donations = [...(data.donations || []), donation];
      writeData(data);
      notifyDataChange("donation-recorded", { donationId: donation.id });
      sendJson(response, 201, donation);
    } catch (error) {
      sendJson(response, 400, { error: error.message || "Invalid donation request" });
    }
    return;
  }

  if (url.pathname === "/api/feedback" && request.method === "POST") {
    try {
      const body = JSON.parse(await readRequestBody(request));
      const suggestion = {
        id: `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: String(body.name || "").trim(),
        email: String(body.email || "").trim(),
        type: String(body.type || "Other").trim(),
        message: String(body.message || "").trim(),
        createdAt: new Date().toISOString()
      };
      if (!suggestion.name || !suggestion.email || !suggestion.message) {
        sendJson(response, 400, { error: "Name, email, and message are required" });
        return;
      }
      const data = readData();
      data.suggestions = [...(data.suggestions || []), suggestion];
      writeData(data);
      notifyDataChange("feedback-created", { feedbackId: suggestion.id });
      sendJson(response, 201, { suggestion, suggestions: data.suggestions });
    } catch {
      sendJson(response, 400, { error: "Invalid feedback request" });
    }
    return;
  }

  const filePath = safePath(url.pathname);
  if (!filePath) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(ROOT, "index.html"), (fallbackError, fallbackContent) => {
        if (fallbackError) {
          sendJson(response, 404, { error: "Not found" });
          return;
        }
        response.writeHead(200, { "Content-Type": types[".html"] });
        response.end(fallbackContent);
      });
      return;
    }

    const extension = path.extname(filePath);
    response.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream" });
    response.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`SoundSlot running on http://localhost:${PORT}`);
});
