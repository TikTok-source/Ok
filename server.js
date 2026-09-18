const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("token-cards.db");

// 📧 Configuración Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});
transporter.verify()
  .then(() => console.log("✅ Gmail listo"))
  .catch(err => console.log("❌ Gmail:", err.message));

// 📝 IMPORTANTE: PARSER PRIMERO, LUEGO RUTAS, ESTÁTICO AL FINAL
app.use(express.json({ limit: "20kb" })); // ✅ Asegura leer bien JSON

// 🗄️ Base de datos
db.exec(`
CREATE TABLE IF NOT EXISTS users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
email TEXT UNIQUE NOT NULL,
name TEXT NOT NULL,
balance INTEGER NOT NULL DEFAULT 0,
codigo TEXT
);
CREATE TABLE IF NOT EXISTS recharge_requests (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER NOT NULL,
tokens INTEGER NOT NULL,
price REAL NOT NULL,
review TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'pending',
created_at TEXT NOT NULL,
FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

// 🔒 Admin
function admin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "No autorizado." });
  }
  next();
}

// 📤 Enviar código
async function enviarCodigoGmail(destino, codigo, nombre) {
  try {
    const info = await transporter.sendMail({
      from: `"Token Cards" <${process.env.GMAIL_USER}>`,
      to: destino,
      subject: "Tu código de verificación",
      html: `<div style="font-family:Arial;padding:20px;">
              <h2>Hola ${nombre}</h2>
              <p>Tu código: <strong style="font-size:26px;">${codigo}</strong></p>
             </div>`
    });
    console.log("✅ Correo enviado:", info.messageId);
    return { ok: true };
  } catch (err) {
    console.log("❌ Error correo:", err.message);
    return { ok: false, error: err.message };
  }
}

// 📌 API RUTAS (TODAS ARRIBA, ANTES DE ARCHIVOS ESTÁTICOS)
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/recharge", async (req, res) => {
  try {
    const { name, email, review, tokens } = req.body;
    const cleanName = String(name||"").trim();
    const cleanEmail = String(email||"").trim().toLowerCase();
    const cleanReview = String(review||"").trim();
    const amount = Number(tokens);

    if (!cleanName || !cleanEmail || !cleanReview)
      return res.status(400).json({ error: "Completa todos los campos." });
    if (!cleanEmail.includes("@"))
      return res.status(400).json({ error: "Correo inválido." });
    if (!Number.isInteger(amount) || amount <10 || amount%10!==0)
      return res.status(400).json({ error: "Mínimo 10, múltiplos de 10." });

    let user = db.prepare(`SELECT * FROM users WHERE email=?`).get(cleanEmail);
    if (!user) {
      const id = db.prepare(`INSERT INTO users (email,name,balance) VALUES (?,?,0)`).run(cleanEmail,cleanName).lastInsertRowid;
      user = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
    } else {
      db.prepare(`UPDATE users SET name=? WHERE id=?`).run(cleanName,user.id);
    }

    const codigo = Math.floor(100000+Math.random()*900000).toString();
    db.prepare(`UPDATE users SET codigo=? WHERE id=?`).run(codigo,user.id);
    await enviarCodigoGmail(cleanEmail,codigo,cleanName);

    const price = amount/10;
    const reqId = db.prepare(`INSERT INTO recharge_requests (user_id,tokens,price,review,status,created_at) VALUES (?,?,?,?,?,?)`)
      .run(user.id,amount,price,cleanReview,"pending",new Date().toISOString()).lastInsertRowid;

    res.json({ ok:true, requestId:reqId, message:"Solicitud enviada ✅" });
  } catch (e) {
    console.log("❌ /api/recharge:",e);
    res.status(500).json({ error:"Error interno." });
  }
});

app.get("/api/balance", (req, res) => {
  try {
    const email = String(req.query.email||"").trim().toLowerCase();
    if (!email) return res.status(400).json({ error:"Falta correo." });
    const u = db.prepare(`SELECT balance FROM users WHERE email=?`).get(email);
    res.json({ balance:u?.balance||0 });
  } catch(e){res.status(500).json({error:"Error"})}
});

app.post("/api/purchase", (req, res) => {
  try {
    const {email,price} = req.body;
    const e = String(email||"").trim().toLowerCase();
    const cost = Number(price);
    if (!e || !Number.isInteger(cost)||cost<=0) return res.status(400).json({error:"Datos mal"});
    const u = db.prepare(`SELECT * FROM users WHERE email=?`).get(e);
    if (!u) return res.status(404).json({error:"Usuario no encontrado"});
    if (u.balance < cost) return res.status(400).json({error:"Saldo insuficiente"});
    const r = db.prepare(`UPDATE users SET balance=balance-? WHERE id=? AND balance>=?`).run(cost,u.id,cost);
    if (r.changes!==1) return res.status(400).json({error:"No se pudo"});
    const nuevo = db.prepare(`SELECT balance FROM users WHERE id=?`).get(u.id);
    res.json({ ok:true, balance:nuevo.balance });
  }catch(e){res.status(500).json({error:"Error"})}
});

app.get("/api/admin/requests", admin, (req, res) => {
  try {
    const list = db.prepare(`SELECT r.id,u.name,u.email,r.tokens,r.price,r.review,r.status FROM recharge_requests r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC`).all();
    res.json(list);
  }catch(e){res.status(500).json({error:"Error"})}
});

app.post("/api/admin/approve/:id", admin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({error:"ID inválido"});
    const sol = db.prepare(`SELECT * FROM recharge_requests WHERE id=?`).get(id);
    if (!sol) return res.status(404).json({error:"No existe"});
    if (sol.status!=="pending") return res.status(400).json({error:"Ya procesada"});
    db.transaction(()=>{
      db.prepare(`UPDATE users SET balance=balance+? WHERE id=?`).run(sol.tokens,sol.user_id);
      db.prepare(`UPDATE recharge_requests SET status='approved' WHERE id=?`).run(id);
    })();
    res.json({ ok:true, message:`+${sol.tokens} TOK` });
  }catch(e){res.status(500).json({error:"Error"})}
});

app.post("/api/admin/reject/:id", admin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({error:"ID inválido"});
    const sol = db.prepare(`SELECT * FROM recharge_requests WHERE id=?`).get(id);
    if (!sol) return res.status(404).json({error:"No existe"});
    if (sol.status!=="pending") return res.status(400).json({error:"Ya procesada"});
    db.prepare(`UPDATE recharge_requests SET status='rejected' WHERE id=?`).run(id);
    res.json({ ok:true, message:"Rechazada" });
  }catch(e){res.status(500).json({error:"Error"})}
});

// 📁 ARCHIVOS ESTÁTICOS Y PÁGINAS → AL FINAL, DESPUÉS DE LA API
app.use(express.static(__dirname, { extensions: ["html"] })); // ✅ Sirve index/admin sin carpeta public

app.get("/", (req, res) => res.sendFile(path.join(__dirname,"index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname,"admin.html")));

// ❌ 404 JSON (IMPORTANTE: NO DEVUELVA HTML)
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Ruta API no encontrada" });
  } else {
    res.status(404).sendFile(path.join(__dirname,"index.html"));
  }
});

app.listen(PORT, () => console.log(`🚀 Puerto ${PORT} | Todo JSON en API ✅`));
