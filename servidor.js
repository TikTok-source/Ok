const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const PORT = 3000;

// TUS DATOS ✅ CORRECTOS
const MI_CORREO = "hacker9d0@gmail.com";       
const MI_CLAVE_GMAIL = "afkx sype etgt qhbj"; 
const CLAVE_ADMIN = "admin123";               

// Configurar correo ✅ ARREGLADO
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { 
    user: MI_CORREO,   // 👌 Mejor usa la variable para no repetir
    pass: MI_CLAVE_GMAIL 
  }
});

// Verificar conexión con Gmail
transporter.verify()
  .then(() => console.log("✅ CONECTADO A GMAIL CORRECTAMENTE"))
  .catch(err => console.log("❌ ERROR GMAIL:", err.message));

// Base de datos
const db = new Database("token-cards.db");
app.use(express.json({ limit: "20kb" }));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
email TEXT UNIQUE NOT NULL,
name TEXT NOT NULL,
balance INTEGER DEFAULT 0,
codigo TEXT
);
CREATE TABLE IF NOT EXISTS recharge_requests (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id INTEGER, tokens INTEGER, price REAL,
review TEXT, status TEXT DEFAULT 'pending', created_at TEXT
);
`);

// Seguridad admin
function admin(req, res, next) {
  if (req.headers["x-admin-key"] !== CLAVE_ADMIN)
    return res.status(401).json({ error: "No autorizado" });
  next();
}

// Enviar código por correo
async function enviarCodigo(correo, nombre, codigo) {
  try {
    await transporter.sendMail({
      from: `"Tu Sistema" <${MI_CORREO}>`,
      to: correo,
      subject: "Tu código de acceso ✅",
      html: `<div style="font-family:Arial;padding:20px;">
              <h2>Hola ${nombre}</h2>
              <p>Tu código es:</p>
              <h1 style="background:#f1f1f1;padding:10px;">${codigo}</h1>
             </div>`
    });
    return { ok: true };
  } catch (e) {
    console.log("Error correo:", e);
    return { ok: false, error: e.message };
  }
}

// RUTAS DE LA API (PRIMERO, PARA QUE NO DE HTML)
app.post("/api/recharge", async (req, res) => {
  try {
    const { name, email, review, tokens } = req.body;
    
    if (!name || !email || !review || !tokens)
      return res.json({ ok: false, error: "Llena todos los campos" });
    if (!email.includes("@"))
      return res.json({ ok: false, error: "Correo inválido" });
    if (tokens < 10 || tokens % 10 !== 0)
      return res.json({ ok: false, error: "Mínimo 10 tokens y múltiplo de 10" });

    let user = db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
    if (!user) {
      const id = db.prepare(`INSERT INTO users (email,name) VALUES (?,?)`).run(email,name).lastInsertRowid;
      user = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare(`UPDATE users SET codigo=? WHERE id=?`).run(codigo, user.id);
    
    const envio = await enviarCodigo(email, name, codigo);
    if (!envio.ok)
      return res.json({ ok: false, error: "No se pudo enviar: " + envio.error });

    db.prepare(`INSERT INTO recharge_requests 
      (user_id,tokens,price,review,created_at) VALUES (?,?,?,?,?)`)
      .run(user.id, tokens, tokens/10, review, new Date().toISOString());

    res.json({ ok: true, mensaje: "¡LISTO! Revisa tu correo 📩" });

  } catch (err) {
    console.log("Error servidor:", err);
    res.json({ ok: false, error: "Error interno" });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

// PÁGINAS Y ARCHIVOS (AL FINAL)
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use(express.static(__dirname));

app.use((req, res) => {
  if (req.path.startsWith("/api/"))
    res.json({ error: "Ruta no encontrada" });
  else
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => console.log("✅ SERVIDOR LISTO EN PUERTO 3000"));
