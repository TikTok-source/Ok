const express = require("express");
const Database = require("better-sqlite3");
require("dotenv").config();

const app = express();

// ===============================
// CONFIGURACIÓN
// ===============================

const PORT = process.env.PORT || 3000;
const db = new Database("token-cards.db");

app.use(express.json({ limit: "20kb" }));
app.use(express.static("public"));

// ===============================
// BASE DE DATOS
// ===============================

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

// ===============================
// MIDDLEWARE ADMIN
// ===============================

function admin(req, res, next) {
    const key = req.headers["x-admin-key"];

    if (!key || key !== process.env.ADMIN_KEY) {
        return res.status(401).json({
            error: "No autorizado."
        });
    }

    next();
}

// ===============================
// CREAR SOLICITUD DE RECARGA
// ===============================

app.post("/api/recharge", (req, res) => {
    try {
        const {
            name,
            email,
            review,
            tokens
        } = req.body;

        const cleanName = String(name || "").trim();
        const cleanEmail = String(email || "").trim().toLowerCase();
        const cleanReview = String(review || "").trim();
        const amount = Number(tokens);

        if (!cleanName || !cleanEmail || !cleanReview) {
            return res.status(400).json({
                error: "Completa todos los campos."
            });
        }

        if (!cleanEmail.includes("@")) {
            return res.status(400).json({
                error: "Correo electrónico inválido."
            });
        }

        if (
            !Number.isInteger(amount) ||
            amount < 10 ||
            amount % 10 !== 0
        ) {
            return res.status(400).json({
                error: "La cantidad debe ser un múltiplo de 10 TOK."
            });
        }

        let user = db
            .prepare(`
                SELECT *
                FROM users
                WHERE email = ?
            `)
            .get(cleanEmail);

        // Crear usuario si no existe
        if (!user) {
            const result = db
                .prepare(`
                    INSERT INTO users
                    (email, name, balance)
                    VALUES (?, ?, 0)
                `)
                .run(cleanEmail, cleanName);

            user = db
                .prepare(`
                    SELECT *
                    FROM users
                    WHERE id = ?
                `)
                .get(result.lastInsertRowid);
        } else {
            // Actualizar nombre por si cambió
            db.prepare(`
                UPDATE users
                SET name = ?
                WHERE id = ?
            `).run(cleanName, user.id);
        }

        const price = amount / 10;

        const result = db
            .prepare(`
                INSERT INTO recharge_requests
                (
                    user_id,
                    tokens,
                    price,
                    review,
                    status,
                    created_at
                )
                VALUES (?, ?, ?, ?, 'pending', ?)
            `)
            .run(
                user.id,
                amount,
                price,
                cleanReview,
                new Date().toISOString()
            );

        res.json({
            ok: true,
            requestId: result.lastInsertRowid,
            message: "Solicitud enviada. Queda pendiente de aprobación."
        });

    } catch (error) {
        console.error("Error /api/recharge:", error);

        res.status(500).json({
            error: "Error interno del servidor."
        });
    }
});

// ===============================
// CONSULTAR BALANCE
// ===============================

app.get("/api/balance", (req, res) => {
    try {
        const email = String(
            req.query.email || ""
        ).trim().toLowerCase();

        if (!email) {
            return res.status(400).json({
                error: "Correo requerido."
            });
        }

        const user = db
            .prepare(`
                SELECT email, name, balance
                FROM users
                WHERE email = ?
            `)
            .get(email);

        if (!user) {
            return res.json({
                balance: 0
            });
        }

        res.json({
            balance: user.balance
        });

    } catch (error) {
        console.error("Error /api/balance:", error);

        res.status(500).json({
            error: "Error interno del servidor."
        });
    }
});

// ===============================
// COMPRAR PRODUCTO
// ===============================

app.post("/api/purchase", (req, res) => {
    try {
        const {
            email,
            price
        } = req.body;

        const cleanEmail = String(
            email || ""
        ).trim().toLowerCase();

        const cost = Number(price);

        if (
            !cleanEmail ||
            !Number.isInteger(cost) ||
            cost <= 0
        ) {
            return res.status(400).json({
                error: "Datos de compra inválidos."
            });
        }

        const user = db
            .prepare(`
                SELECT *
                FROM users
                WHERE email = ?
            `)
            .get(cleanEmail);

        if (!user) {
            return res.status(404).json({
                error: "Usuario no encontrado."
            });
        }

        if (user.balance < cost) {
            return res.status(400).json({
                error: "Saldo insuficiente."
            });
        }

        // Descontar TOK de forma segura
        const result = db
            .prepare(`
                UPDATE users
                SET balance = balance - ?
                WHERE id = ?
                AND balance >= ?
            `)
            .run(
                cost,
                user.id,
                cost
            );

        if (result.changes !== 1) {
            return res.status(400).json({
                error: "No se pudo completar la compra."
            });
        }

        const updated = db
            .prepare(`
                SELECT balance
                FROM users
                WHERE id = ?
            `)
            .get(user.id);

        res.json({
            ok: true,
            balance: updated.balance
        });

    } catch (error) {
        console.error("Error /api/purchase:", error);

        res.status(500).json({
            error: "Error interno del servidor."
        });
    }
});

// ===============================
// ADMIN — VER SOLICITUDES
// ===============================

app.get("/api/admin/requests", admin, (req, res) => {
    try {
        const requests = db
            .prepare(`
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
            `)
            .all();

        res.json(requests);

    } catch (error) {
        console.error("Error /api/admin/requests:", error);

        res.status(500).json({
            error: "Error interno del servidor."
        });
    }
});

// ===============================
// ADMIN — APROBAR RECARGA
// ===============================

app.post("/api/admin/approve/:id", admin, (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {
            return res.status(400).json({
                error: "ID inválido."
            });
        }

        const request = db
            .prepare(`
                SELECT *
                FROM recharge_requests
                WHERE id = ?
            `)
            .get(id);

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

        // Aprobar y agregar TOK dentro de una transacción
        const transaction = db.transaction(() => {

            db.prepare(`
                UPDATE users
                SET balance = balance + ?
                WHERE id = ?
            `).run(
                request.tokens,
                request.user_id
            );

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

    } catch (error) {
        console.error("Error /api/admin/approve:", error);

        res.status(500).json({
            error: "No se pudo aprobar la solicitud."
        });
    }
});

// ===============================
// ADMIN — RECHAZAR RECARGA
// ===============================

app.post("/api/admin/reject/:id", admin, (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {
            return res.status(400).json({
                error: "ID inválido."
            });
        }

        const request = db
            .prepare(`
                SELECT *
                FROM recharge_requests
                WHERE id = ?
            `)
            .get(id);

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
        `).run(id);

        res.json({
            ok: true,
            message: "Solicitud rechazada."
        });

    } catch (error) {
        console.error("Error /api/admin/reject:", error);

        res.status(500).json({
            error: "No se pudo rechazar la solicitud."
        });
    }
});

// ===============================
// HEALTH CHECK
// ===============================

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        service: "Token Cards",
        status: "online"
    });
});

// ===============================
// RUTA PRINCIPAL
// ===============================

app.get("/", (req, res) => {
    res.sendFile("index.html", {
        root: "public"
    });
});

// ===============================
// MANEJO DE ERRORES 404
// ===============================

app.use((req, res) => {
    res.status(404).json({
        error: "Ruta no encontrada."
    });
});

// ===============================
// INICIAR SERVIDOR
// ===============================

app.listen(PORT, () => {
    console.log(
        `Token Cards funcionando en puerto ${PORT}`
    );
});
