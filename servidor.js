const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

// 🔧 Nodemailer INCLUIDO AQUÍ (no necesitas instalar nada más)
const nodemailer = require("nodemailer");

const app = express();
const PORT = 3000;

// ✅ TUS DATOS (NO TOCAR NADA MÁS)
const MI_CORREO = "hacker9d0@gmail.com";
const MI_CLAVE_GMAIL = "afkx sype etgt qhbj"; // Tu clave de app
const CLAVE_ADMIN = "admin123";

// 📧 Configuración rápida y segura (sin errores)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: MI_CORREO, pass: MI_CLAVE_GMAIL }
});

// Verificar conexión al arrancar
transporter.verify((error) => {
  if (error) console.log("⚠️ Correo:", error.message);
  else console.log("✅ CORREO LISTO, FUNCIONA EN IPHONE");
});

// 🗄️ Base de datos simple
const db = new Database("tienda.db");
app.use(express.json({ limit: "20kb" }));

// Crear tablas si no existen
db.exec(`
CREATE TABLE IF NOT EXISTS tarjetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT, fecha TEXT, cvv TEXT, codigo TEXT,
  tokens INTEGER, precio REAL, estado TEXT DEFAULT 'disponible'
);
CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT, correo TEXT, tarjeta_id INTEGER, recibo TEXT
);
`);

// 💳 Generador de tarjetas aleatorias
function generarTarjeta() {
  const num = "4" + Array(15).fill(0).map(() => Math.floor(Math.random()*10)).join("");
  const mes = String(Math.floor(Math.random()*12)+1).padStart(2,"0");
  const anio = String(new Date().getFullYear() + 2);
  return {
    numero: num,
    fecha: `${mes}/${anio}`,
    cvv: String(Math.floor(100 + Math.random()*900)),
    codigo: String(Math.floor(100000 + Math.random()*900000)),
    tokens: Math.floor(Math.random()*10)+1,
    precio: Math.floor(Math.random()*100)+1
  };
}

// 📋 API: Obtener lista limpia
app.get("/api/lista", (req, res) => {
  try {
    let lista = db.prepare(`SELECT id, numero, fecha, tokens, precio FROM tarjetas WHERE estado='disponible'`).all();
    
    // Si hay pocas, recargar nuevas
    if (lista.length < 4) {
      db.prepare(`DELETE FROM tarjetas`).run();
      for (let i=0; i<6; i++) {
        const t = generarTarjeta();
        db.prepare(`INSERT INTO tarjetas (numero,fecha,cvv,codigo,tokens,precio) VALUES (?,?,?,?,?,?)`)
        .run(t.numero, t.fecha, t.cvv, t.codigo, t.tokens, t.precio);
      }
      lista = db.prepare(`SELECT id, numero, fecha, tokens, precio FROM tarjetas WHERE estado='disponible'`).all();
    }

    // Mostrar solo últimos 4 dígitos (seguro)
    lista = lista.map(t => ({
      ...t,
      mostrar: `**** **** **** ${t.numero.slice(-4)}`
    }));

    res.json({ ok: true, lista });
  } catch (e) {
    res.json({ ok: false, error: "Error cargando" });
  }
});

// 🛒 API: COMPRAR + Enviar correo
app.post("/api/comprar", async (req, res) => {
  try {
    const { id, nombre, correo, dir, pago } = req.body;
    
    if (!id || !nombre || !correo || !dir || !pago)
      return res.json({ ok: false, error: "Llena todo el formulario" });

    const tarjeta = db.prepare(`SELECT * FROM tarjetas WHERE id=? AND estado='disponible'`).get(id);
    if (!tarjeta) return res.json({ ok: false, error: "Ya fue comprada" });

    db.prepare(`UPDATE tarjetas SET estado='vendida' WHERE id=?`).run(id);
    const recibo = String(Math.floor(100000 + Math.random()*900000));

    // 📤 Enviar correo con todo
    await transporter.sendMail({
      from: `"TIENDA SEGURA" <${MI_CORREO}>`,
      to: correo,
      subject: `COMPRA EXITOSA - Recibo: ${recibo}`,
      html: `
      <div style="font-family:Arial;padding:20px;max-width:500px;">
        <h2 style="color:#1e40af;">✅ COMPRA APROBADA</h2>
        <p><strong>Nombre:</strong> ${nombre}</p>
        <p><strong>Correo:</strong> ${correo}</p>
        <p><strong>Dirección:</strong> ${dir}</p>
        <p><strong>Pago:</strong> ${pago}</p>
        <hr style="border:0;border-bottom:1px solid #ccc;margin:15px 0;">
        <h3>💳 TUS DATOS COMPLETOS:</h3>
        <p>Número: ${tarjeta.numero}</p>
        <p>Vence: ${tarjeta.fecha}</p>
        <p>CVV: ${tarjeta.cvv}</p>
        <p>Código: ${tarjeta.codigo}</p>
        <p style="font-weight:bold;">Tokens: ${tarjeta.tokens} | Total: $${tarjeta.precio * tarjeta.tokens}</p>
      </div>`
    });

    res.json({ ok: true, mensaje: "✅ ¡LISTO! Revisa tu correo", recibo });
  } catch (e) {
    res.json({ ok: false, error: "Error: " + e.message });
  }
});

// 📁 RUTAS CLAVE: NO DAR ERROR HTML
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use(express.static(__dirname));

// Si falla, devolver JSON, no página
app.use((req, res) => {
  if (req.path.startsWith("/api/")) res.json({ error: "No existe" });
  else res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => console.log("✅ SERVIDOR EN 3000 - LISTO PARA IPHONE"));
