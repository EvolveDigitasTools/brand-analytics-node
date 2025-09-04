// db.js
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

let db;

try {
    db = await mysql.createPool({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    port: process.env.DATABASE_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    });
     console.log("✅ Connected to MySQL database");
} catch (err) {
  console.error("❌ Database connection failed:", err.message);
}

export default db;