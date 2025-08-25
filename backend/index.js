import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Database config
const db = await mysql.createPool({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: process.env.DATABASE_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Multer config
const upload = multer({ dest: "uploads/" });

//Running port
const PORT = process.env.PORT || 4000;

//Heath test
app.get("/", (req, res) => {
  res.send("✅ Backend is running!");
});

// Upload route
app.post("/upload", upload.single("file"), async (req, res) => {
    console.log("Uploaded file:", req.file);
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    // Read file
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let results = [];

    for (const row of sheet) {
      const skuCode = row["SKU"];
      const qty = parseInt(row["Quantity"]);

      if (!skuCode || isNaN(qty)) continue; //skip invalid rows

      // 1. Find SKU ID
      const [skuRows] = await db.query(
        "SELECT id FROM sku WHERE skuCode = ?",
        [skuCode]
      );

      if (skuRows.length === 0) {
        results.push({ skuCode, error: "SKU not found" });
        continue;
      }

      const skuID = skuRows[0].id;

      // 2. Find inventory for this SKU
      const [invRows] = await db.query(
        "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
        [skuID]
      );

      if (invRows.length === 0) {
        results.push({ skuCode, error: "No inventory record found" });
        continue;
      }

      const inventory = invRows[0];
      let newQty = inventory.quantity - qty;
      if (newQty < 0) newQty = 0;

      // 3. Update inventory
      await db.query(
        "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
        [newQty, inventory.id]
      );

      results.push({
        skuCode,
        oldQty: inventory.quantity,
        deducted: qty,
        newQty,
      });
    }

    res.json({ message: "Inventory updated", results });
    

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});


app.listen(PORT, () => {
  console.log(`Node backend running on port ${PORT}`);
});
