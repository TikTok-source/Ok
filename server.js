const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const db = new Database("token-cards.db");

app.use(express.json({ limit: "20kb" }));
app.use(express.static("public"));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0
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

function admin(req, res, next) {
    const key = req.headers["x-admin-key"];

    if (!key || key !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: "No autorizado" });
    }

    next();
}

app.post("/api/recharge", (req, res) => {
    const { name, email, review, tokens } = req.body;

    const amount = Number(tokens);

    if (!name || !email || !review) {
        return res.status(400).json({
            error: "Completa todos los campos."
        });
    }

    if (!Number.isInteger(amount) || amount < 10 || amount % 10 !== 0) {
        return res.status(400).json({
            error: "La cantidad debe ser un múltiplo de 10 TOK."
        });
    }

    let user = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(email);

    if (!user) {
        const result = db.prepare(`
            INSERT INTO users (email, name, balance)
            VALUES (?, ?, 0)
        `).run(email, name);

        user = db
            .prepare("SELECT * FROM users WHERE id = ?")
            .get(result.lastInsertRowid);
    }

    const price = amount / 10;

    const result = db.prepare(`
        INSERT INTO recharge_requests
        (user_id, tokens, price, review, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(
        user.id,
        amount,
        price,
        review,
        new Date().toISOString()
    );

    res.json({
        ok: true,
        requestId: result.lastInsertRowid,
        message: "Solicitud enviada. Queda pendiente de aprobación."
    });
});

app.get("/api/balance", (req, res) => {
    const email = String(req.query.email || "");

    if (!email) {
        return res.status(400).json({
            error: "Correo requerido."
        });
    }

    const user = db
        .prepare("SELECT email, name, balance FROM users WHERE email = ?")
        .get(email);

    if (!user) {
        return res.json({
            balance: 0
        });
    }

    res.json({
        balance: user.balance
    });
});

app.get("/api/admin/requests", admin, (req, res) => {
    const requests = db.prepare(`
        SELECT
            recharge_requests.id,
            users.name,
            users.email,
            recharge_requests.tokens,
            recharge_requests.price,
            recharge_requests.review,
            recharge_requests.status,
            recharge_requests.created_at
        FROM recharge_requests
        JOIN users
        ON users.id = recharge_requests.user_id
        ORDER BY recharge_requests.id DESC
    `).all();

    res.json(requests);
});

app.post("/api/admin/approve/:id", admin, (req, res) => {
    const request = db.prepare(`
        SELECT * FROM recharge_requests
        WHERE id = ?
    `).get(req.params.id);

    if (!request) {
        return res.status(404).json({
            error: "Solicitud no encontrada."
        });
    }

    if (request.status !== "pending") {
        return res.status(400).json({
            error: "Esta solicitud ya fue procesada."
        });
    }

    const transaction = db.transaction(() => {
        db.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE id = ?
        `).run(request.tokens, request.user_id);

        db.prepare(`
            UPDATE recharge_requests
            SET status = 'approved'
            WHERE id = ?
        `).run(request.id);
    });

    transaction();

    res.json({
        ok: true,
        message: `Se agregaron ${request.tokens} TOK.`
    });
});

app.post("/api/admin/reject/:id", admin, (req, res) => {
    const request = db.prepare(`
        SELECT * FROM recharge_requests
        WHERE id = ?
    `).get(req.params.id);

    if (!request) {
        return res.status(404).json({
            error: "Solicitud no encontrada."
        });
    }

    if (request.status !== "pending") {
        return res.status(400).json({
            error: "Esta solicitud ya fue procesada."
        });
    }

    db.prepare(`
        UPDATE recharge_requests
        SET status = 'rejected'
        WHERE id = ?
    `).run(request.id);

    res.json({
        ok: true,
        message: "Solicitud rechazada."
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Token Cards funcionando en puerto ${PORT}`);
});
