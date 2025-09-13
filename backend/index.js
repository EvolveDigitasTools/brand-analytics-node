import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import db from "./db.js";
import cron from "node-cron";
import comboSkuRutes from "./routes/comboSkuRoutes.js"; //Combo Routes
import { fetchAndStoreAmazonOrders } from "./amazon/amazonOrders.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===== Combo SKU Mapping Route ======
app.use("/api/combo-sku", comboSkuRutes);

// Multer config
const upload = multer({ dest: "uploads/" });

//Running port
const PORT = process.env.PORT || 4000;

//Heath test
app.get("/", (req, res) => {
  res.send("✅ Backend is running!");
});

// ====================== MARKETPLACES INVENTORY UPDATE ======================

// Meesho Sheet Upload
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const startTime = Date.now();
  let results = [];

  // Allowed status values
  const allowedReasons = [
        "SHIPPED", 
        "DELIVERED", 
        "READY_TO_SHIP", 
        "DOOR_STEP_EXCHANGED"
    ];

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    for (const row of sheet) {
      const originalSku = row["SKU"];   // keep original for reporting
      let skuCode = String(originalSku).trim(); // force string
      const qty = parseInt(row["Quantity"]);
      const reason = row["Reason for Credit Entry"];

      if (!skuCode || isNaN(qty)) {
        results.push({ skuCode: originalSku, error: "Invalid SKU/Quantity" });
        continue;
      }

      // Skip rows not in allowed reasons
      if (!allowedReasons.includes(reason)) continue;

      try {
        // Default multiplier = 1
        let rawSkuCode = skuCode; // backup original with PKx
        let multiplier = 1;

        // Check if SKU has -PKx at the end
        const pkMatch = skuCode.match(/-PK(\d+)$/i);
        if (pkMatch) {
          multiplier = parseInt(pkMatch[1]);
          skuCode = skuCode.replace(/-PK\d+$/i, ""); // strip suffix for lookup
        }

        // Effective deduction
        const deductQty = qty * multiplier;

        // 🔹 1) Check if SKU is a normal SKU in sku table
        const [skuRows] = await db.query(
          "SELECT id FROM sku WHERE skuCode = ?",
          [skuCode]
        );

        if (skuRows.length > 0) {
          // ✅ Normal SKU update (your existing logic)
          const skuID = skuRows[0].id;
          const [invRows] = await db.query(
            "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
            [skuID]
          );

          if (invRows.length === 0) {
            results.push({ skuCode: originalSku, error: "No inventory record found" });
            continue;
          }

          const inventory = invRows[0];
          let newQty = Math.max(0, inventory.quantity - deductQty);

          await db.query(
            "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
            [newQty, inventory.id]
          );

          results.push({
            originalSku: String(originalSku),
            baseSku: skuCode,
            oldQty: inventory.quantity,
            deducted: deductQty,
            newQty,
            reason,
          });

        } else {
            // Try combo SKU
            const [comboRows] = await db.query(
                `SELECT csi.sku_id, csi.quantity 
                FROM combo_sku cs
                JOIN combo_sku_items csi ON cs.id = csi.combo_sku_id
                WHERE cs.combo_name = ?`,
                [rawSkuCode]
            );

            if (comboRows.length === 0) {
                results.push({ skuCode: originalSku, error: "SKU not found (normal or combo)" });
                continue;
            }

            // Loop through child SKUs and deduct inventory
            for (const child of comboRows) {
                const [invRows] = await db.query(
                    "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
                    [child.sku_id]
                );

                if (invRows.length === 0) {
                    results.push({ skuCode: child.sku_id, error: "No inventory record found" });
                    continue;
                }

                const inventory = invRows[0];
                const deductQty = qty * child.quantity; // qty * combo qty
                let newQty = Math.max(0, inventory.quantity - deductQty);

                await db.query(
                    "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
                    [newQty, inventory.id]
                );

                results.push({
                    comboSku: skuCode,
                    childSku: child.sku_id,
                    oldQty: inventory.quantity,
                    deducted: deductQty,
                    newQty,
                    reason,
                });
            }
        }


      } catch (err) {
        results.push({ skuCode: originalSku, error: err.message });
      }
    }

    // delete uploaded file
    fs.unlink(req.file.path, (err) => {
      if (err) console.error("File cleanup failed:", err);
    });

    res.json({
      message: "Inventory updated",
      totalProcessed: results.length,
      totalErrors: results.filter(r => r.error).length,
      executionTime: (Date.now() - startTime) + "ms",
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});


// Amazon Sheet Upload
app.post("/upload-amazon", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const startTime = Date.now();
  let results = [];

  // Allowed Amazon order statuses
  const allowedReasons = [
    "Pending",
    "Shipped",
    "Shipped - Delivered to Buyer",
    "Shipped - Out for Delivery",
    "Shipped - Picked Up",
    "Shipped - Returning to Seller",
    "Shipping",
  ];

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    for (const row of sheet) {
      const originalSku = row["sku"]; // Amazon sheet column
      let skuCode = String(originalSku || "").trim();
      const qty = parseInt(row["quantity"]);
      const reason = row["order-status"];

      if (!skuCode || isNaN(qty)) {
        results.push({ skuCode: originalSku, error: "Invalid SKU/Quantity" });
        continue;
      }

      if (!allowedReasons.includes(reason)) continue; // skip unwanted rows

      // Handle PK multiplier
      let multiplier = 1;
      const pkMatch = skuCode.match(/-PK(\d+)$/i);
      if (pkMatch) {
        multiplier = parseInt(pkMatch[1]);
        skuCode = skuCode.replace(/-PK\d+$/i, "");
      }

      try {
        // 1 Normal SKU (match Amazon column name style)
        const [skuRows] = await db.query(
          "SELECT id FROM sku WHERE skuCode = ?",
          [skuCode]
        );

        if (skuRows.length > 0) {
          const skuID = skuRows[0].id;
          const [invRows] = await db.query(
            "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
            [skuID]
          );

          if (invRows.length === 0) {
            results.push({ skuCode: originalSku, error: "No inventory record found" });
            continue;
          }

          const inventory = invRows[0];
          let newQty = Math.max(0, inventory.quantity - qty * multiplier);

          await db.query(
            "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
            [newQty, inventory.id]
          );

          results.push({
            originalSku: String(originalSku),
            baseSku: skuCode,
            oldQty: inventory.quantity,
            deducted: qty * multiplier,
            newQty,
            reason,
          });
          continue;
        }

        // 2 Combo SKU
        const [comboRows] = await db.query(
          `SELECT csi.sku_id, csi.quantity
           FROM combo_sku cs
           JOIN combo_sku_items csi ON cs.id = csi.combo_sku_id
           WHERE cs.combo_name = ?`,
          [skuCode]
        );

        if (comboRows.length === 0) {
          results.push({ skuCode: originalSku, error: "SKU not found (normal or combo)" });
          continue;
        }

        for (const child of comboRows) {
          const [invRows] = await db.query(
            "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
            [child.sku_id]
          );

          if (invRows.length === 0) {
            results.push({ skuCode: child.sku_id, error: "No inventory record found" });
            continue;
          }

          const inventory = invRows[0];
          const deductQty = qty * multiplier * child.quantity;
          let newQty = Math.max(0, inventory.quantity - deductQty);

          await db.query(
            "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
            [newQty, inventory.id]
          );

          results.push({
            comboSku: skuCode,
            childSku: child.sku_id,
            oldQty: inventory.quantity,
            deducted: deductQty,
            newQty,
            reason,
          });
        }

      } catch (err) {
        console.error("Error processing SKU:", skuCode, err);
        results.push({ skuCode: originalSku, error: err.message });
      }
    }

    // cleanup
    fs.unlink(req.file.path, (err) => {
      if (err) console.error("File cleanup failed:", err);
    });

    res.json({
      message: "Amazon Inventory updated",
      totalProcessed: results.length,
      totalErrors: results.filter(r => r.error).length,
      executionTime: (Date.now() - startTime) + "ms",
      results,
    });

  } catch (err) {
    console.error("Error processing Amazon file:", err);
    res.status(500).json({ error: "Failed to process Amazon file" });
  }
});

// Flipkart Sheet Upload
// Clean Flipkart SKU (remove extra quotes and SKU: prefix)
function cleanFlipkartSku(rawSku) {
  if (!rawSku) return null;
  return String(rawSku)
    .replace(/^"+|"+$/g, "")   // remove extra quotes
    .replace(/^SKU:/i, "")     // remove SKU: prefix
    .trim();
}
app.post("/upload-flipkart", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const startTime = Date.now();
  let results = [];

  // Allowed Flipkart event types
  const allowedReasons = ["Sale"];

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    for (const row of sheet) {
      const originalSku = cleanFlipkartSku(row["SKU"]);
      let skuCode = cleanFlipkartSku(row["SKU"]);

      const qty = parseInt(row["Item Quantity"]);
      const reason = row["Event Type"];

      if (!skuCode || isNaN(qty)) {
        results.push({ skuCode: originalSku, error: "Invalid SKU/Quantity" });
        continue;
      }

      if (!allowedReasons.includes(reason)) continue; // skip unwanted rows

      // Handle PK multiplier
      let multiplier = 1;
      const pkMatch = skuCode.match(/-PK(\d+)$/i);
      if (pkMatch) {
        multiplier = parseInt(pkMatch[1]);
        skuCode = skuCode.replace(/-PK\d+$/i, "");
      }

      try {
        // 🔹 1) Normal SKU
        const [skuRows] = await db.query(
          "SELECT id FROM sku WHERE skuCode = ?",
          [skuCode]
        );

        if (skuRows.length > 0) {
          const skuID = skuRows[0].id;
          const [invRows] = await db.query(
            "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
            [skuID]
          );

          if (invRows.length === 0) {
            results.push({ skuCode: originalSku, error: "No inventory record found" });
            continue;
          }

          const inventory = invRows[0];
          let newQty = Math.max(0, inventory.quantity - qty * multiplier);

          await db.query(
            "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
            [newQty, inventory.id]
          );

          results.push({
            originalSku: String(originalSku),
            baseSku: skuCode,
            oldQty: inventory.quantity,
            deducted: qty * multiplier,
            newQty,
            reason,
          });
          continue;
        }

        // 🔹 2) Combo SKU
        const [comboRows] = await db.query(
          `SELECT csi.sku_id, csi.quantity
           FROM combo_sku cs
           JOIN combo_sku_items csi ON cs.id = csi.combo_sku_id
           WHERE cs.combo_name = ?`,
          [skuCode]
        );

        if (comboRows.length === 0) {
          results.push({ skuCode: originalSku, error: "SKU not found (normal or combo)" });
          continue;
        }

        for (const child of comboRows) {
          const [invRows] = await db.query(
            "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
            [child.sku_id]
          );

          if (invRows.length === 0) {
            results.push({ skuCode: child.sku_id, error: "No inventory record found" });
            continue;
          }

          const inventory = invRows[0];
          const deductQty = qty * multiplier * child.quantity;
          let newQty = Math.max(0, inventory.quantity - deductQty);

          await db.query(
            "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
            [newQty, inventory.id]
          );

          results.push({
            comboSku: skuCode,
            childSku: child.sku_id,
            oldQty: inventory.quantity,
            deducted: deductQty,
            newQty,
            reason,
          });
        }

      } catch (err) {
        console.error("Error processing SKU:", skuCode, err);
        results.push({ skuCode: originalSku, error: err.message });
      }
    }

    // cleanup
    fs.unlink(req.file.path, (err) => {
      if (err) console.error("File cleanup failed:", err);
    });

    res.json({
      message: "Flipkart Inventory updated",
      totalProcessed: results.length,
      totalErrors: results.filter(r => r.error).length,
      executionTime: (Date.now() - startTime) + "ms",
      results,
    });

  } catch (err) {
    console.error("Error processing Flipkart file:", err);
    res.status(500).json({ error: "Failed to process Flipkart file" });
  }
});

// ====================== AMAZON REAL TIME ORDER STATUS ======================
// Test route to trigger manual sync
app.get("/api/fetch-amazon-orders", async (req, res) => {
  try {
    const result = await fetchAndStoreAmazonOrders();
    res.status(200).json({
      message: "Amazon orders fetched & stored successfully",
      result,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching orders", error: error.message });
  }
});

app.get("/fetch-orders", async (req, res) => {
  const result = await fetchAndStoreAmazonOrders();
  res.json(result);
});

// Run every 1 minute
cron.schedule("*/1 * * * *", async () => {
  console.log("⏳ Fetching Amazon Orders...");
  const result = await fetchAndStoreAmazonOrders();
  console.log("✅ Orders Sync Result:", result);
});

app.listen(PORT, () => {
  console.log(`Node backend running on port ${PORT}`);
});
