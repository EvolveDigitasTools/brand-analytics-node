import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

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

// Meesho Upload route - Phase 2 (Allowed reasons = Shipped, Delivery etc.)
// app.post("/upload", upload.single("file"), async (req, res) => {
//   if (!req.file) return res.status(400).json({ message: "No file uploaded" });

//   const startTime = Date.now();

//   let results = [];

//   // Allowed status values
//     const allowedReasons = ["SHIPPED", "DELIVERED", "READY_TO_SHIP", "DOOR_STEP_EXCHANGED"];

//   try {
//     const workbook = xlsx.readFile(req.file.path);
//     const sheetName = workbook.SheetNames[0];
//     const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

//     for (const row of sheet) {
//       const skuCode = row["SKU"];
//       const qty = parseInt(row["Quantity"]);
//       const reason = row["Reason for Credit Entry"];

//       if (!skuCode || isNaN(qty)) {
//         results.push({ skuCode, error: "Invalid SKU/Quantity" });
//         continue;
//       }

//       // Skip rows not in allowed reasons
//       if (!allowedReasons.includes(reason)) continue;

//       try {
//         const [skuRows] = await db.query(
//           "SELECT id FROM sku WHERE skuCode = ?",
//           [skuCode]
//         );

//         if (skuRows.length === 0) {
//           results.push({ skuCode, error: "SKU not found" });
//           continue;
//         }

//         const skuID = skuRows[0].id;

//         const [invRows] = await db.query(
//           "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
//           [skuID]
//         );

//         if (invRows.length === 0) {
//           results.push({ skuCode, error: "No inventory record found" });
//           continue;
//         }

//         const inventory = invRows[0];
//         let newQty = Math.max(0, inventory.quantity - qty);

//         await db.query(
//           "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//           [newQty, inventory.id]
//         );

//         results.push({
//           skuCode,
//           oldQty: inventory.quantity,
//           deducted: qty,
//           newQty,
//           reason,
//         });

//       } catch (err) {
//         results.push({ skuCode, error: err.message });
//       }
//     }

//     // delete uploaded file
//     fs.unlink(req.file.path, (err) => {
//       if (err) console.error("File cleanup failed:", err);
//     });

//     res.json({
//       message: "Inventory updated",
//       totalProcessed: results.length,
//       totalErrors: results.filter(r => r.error).length,
//       executionTime: (Date.now() - startTime) + "ms",
//       results,
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Something went wrong" });
//   }
// });

// Meesho Upload route - Phase 3 (PK1-9 decrease as 1-9)
// app.post("/upload", upload.single("file"), async (req, res) => {
//   if (!req.file) return res.status(400).json({ message: "No file uploaded" });

//   const startTime = Date.now();

//   let results = [];

//   // Allowed status values
//     const allowedReasons = ["SHIPPED", "DELIVERED", "READY_TO_SHIP", "DOOR_STEP_EXCHANGED",];

//   try {
//     const workbook = xlsx.readFile(req.file.path);
//     const sheetName = workbook.SheetNames[0];
//     const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

//     for (const row of sheet) {
//         const originalSku = row["SKU"];   // keep original for reporting
//         let skuCode = String(originalSku).trim(); // force string
//         const qty = parseInt(row["Quantity"]);
//         const reason = row["Reason for Credit Entry"];

//         if (!skuCode || isNaN(qty)) {
//             results.push({ skuCode: originalSku, error: "Invalid SKU/Quantity" });
//             continue;
//         }

//         // Skip rows not in allowed reasons
//         if (!allowedReasons.includes(reason)) continue;

//         try {
//             // Default multiplier = 1
//             let multiplier = 1;

//             // Check if SKU has -PKx at the end
//             const pkMatch = skuCode.match(/-PK(\d+)$/i);
//             if (pkMatch) {
//             multiplier = parseInt(pkMatch[1]);
//             skuCode = skuCode.replace(/-PK\d+$/i, ""); // strip suffix for lookup
//             }

//             // Effective deduction
//             const deductQty = qty * multiplier;

//             const [skuRows] = await db.query(
//             "SELECT id FROM sku WHERE skuCode = ?",
//             [skuCode]
//             );

//             if (skuRows.length === 0) {
//             results.push({ skuCode: originalSku, error: "SKU not found" });
//             continue;
//             }

//             const skuID = skuRows[0].id;

//             const [invRows] = await db.query(
//             "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
//             [skuID]
//             );

//             if (invRows.length === 0) {
//             results.push({ skuCode: originalSku, error: "No inventory record found" });
//             continue;
//             }

//             const inventory = invRows[0];
//             let newQty = Math.max(0, inventory.quantity - deductQty);

//             await db.query(
//             "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//             [newQty, inventory.id]
//             );

//             results.push({
//             originalSku: String(originalSku), // always log as string
//             baseSku: skuCode,
//             oldQty: inventory.quantity,
//             deducted: deductQty,
//             newQty,
//             reason,
//             });

//         } catch (err) {
//             results.push({ skuCode: originalSku, error: err.message });
//         }
//         }




//     // delete uploaded file
//     fs.unlink(req.file.path, (err) => {
//       if (err) console.error("File cleanup failed:", err);
//     });

//     res.json({
//       message: "Inventory updated",
//       totalProcessed: results.length,
//       totalErrors: results.filter(r => r.error).length,
//       executionTime: (Date.now() - startTime) + "ms",
//       results,
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Something went wrong" });
//   }
// });

// Meesho Upload route - Phase 4 (Combo SKUs Mapping)
// app.post("/upload", upload.single("file"), async (req, res) => {
//   if (!req.file) return res.status(400).json({ message: "No file uploaded" });

//   const startTime = Date.now();
//   let results = [];

//   // Allowed status values
//   const allowedReasons = ["SHIPPED", "DELIVERED", "READY_TO_SHIP", "DOOR_STEP_EXCHANGED"];

//   try {
//     const workbook = xlsx.readFile(req.file.path);
//     const sheetName = workbook.SheetNames[0];
//     const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

//     for (const row of sheet) {
//       const originalSku = row["SKU"];   // keep original for reporting
//       let skuCode = String(originalSku).trim(); // force string
//       const qty = parseInt(row["Quantity"]);
//       const reason = row["Reason for Credit Entry"];

//       if (!skuCode || isNaN(qty)) {
//         results.push({ skuCode: originalSku, error: "Invalid SKU/Quantity" });
//         continue;
//       }

//       // Skip rows not in allowed reasons
//       if (!allowedReasons.includes(reason)) continue;

//       try {
//         // Default multiplier = 1
//         let multiplier = 1;

//         // Check if SKU has -PKx at the end
//         const pkMatch = skuCode.match(/-PK(\d+)$/i);
//         if (pkMatch) {
//           multiplier = parseInt(pkMatch[1]);
//           skuCode = skuCode.replace(/-PK\d+$/i, ""); // strip suffix for lookup
//         }

//         // Effective deduction
//         const deductQty = qty * multiplier;

//         // 🔹 1) Check if SKU is a normal SKU in sku table
//         const [skuRows] = await db.query(
//           "SELECT id FROM sku WHERE skuCode = ?",
//           [skuCode]
//         );

//         if (skuRows.length > 0) {
//           // ✅ Normal SKU update (your existing logic)
//           const skuID = skuRows[0].id;
//           const [invRows] = await db.query(
//             "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
//             [skuID]
//           );

//           if (invRows.length === 0) {
//             results.push({ skuCode: originalSku, error: "No inventory record found" });
//             continue;
//           }

//           const inventory = invRows[0];
//           let newQty = Math.max(0, inventory.quantity - deductQty);

//           await db.query(
//             "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//             [newQty, inventory.id]
//           );

//           results.push({
//             originalSku: String(originalSku),
//             baseSku: skuCode,
//             oldQty: inventory.quantity,
//             deducted: deductQty,
//             newQty,
//             reason,
//           });

//         } else {
//           // 🔹 2) If not found in sku table, maybe it's a combo SKU
//           const [comboRows] = await db.query(
//             "SELECT id FROM combo_sku WHERE combo_name = ?",
//             [skuCode]
//           );

//           if (comboRows.length === 0) {
//             results.push({ skuCode: originalSku, error: "SKU not found (normal or combo)" });
//             continue;
//           }

//           const comboID = comboRows[0].id;

//           // Get child SKUs of combo
//           const [childRows] = await db.query(
//             `SELECT s.id as skuID, s.skuCode, i.id as inventoryID, i.quantity as stock, csi.quantity as comboQty
//              FROM combo_sku_items csi
//              JOIN sku s ON csi.sku_id = s.id
//              JOIN inventory i ON i.skuID = s.id
//              WHERE csi.combo_sku_id = ?`,
//             [comboID]
//           );

//           if (childRows.length === 0) {
//             results.push({ skuCode: originalSku, error: "No child SKUs found for combo" });
//             continue;
//           }

//           for (const child of childRows) {
//             const deductChildQty = deductQty * child.comboQty; // multiply by combo requirement
//             const newQty = Math.max(0, child.stock - deductChildQty);

//             await db.query(
//               "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//               [newQty, child.inventoryID]
//             );

//             results.push({
//               originalSku: String(originalSku),
//               comboSku: skuCode,
//               childSku: child.skuCode,
//               oldQty: child.stock,
//               deducted: deductChildQty,
//               newQty,
//               reason,
//             });
//           }
//         }

//       } catch (err) {
//         results.push({ skuCode: originalSku, error: err.message });
//       }
//     }

//     // delete uploaded file
//     fs.unlink(req.file.path, (err) => {
//       if (err) console.error("File cleanup failed:", err);
//     });

//     res.json({
//       message: "Inventory updated",
//       totalProcessed: results.length,
//       totalErrors: results.filter(r => r.error).length,
//       executionTime: (Date.now() - startTime) + "ms",
//       results,
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Something went wrong" });
//   }
// });

// Meesho Upload route - Phase 5 - Working Done (Combo SKUs)
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


// Amazon Sheet Upload - Phase 1
// app.post("/upload-amazon", upload.single("file"), async (req, res) => {
//   console.log("Uploaded Amazon file:", req.file);
//   try {
//     if (!req.file) return res.status(400).json({ message: "No file uploaded" });

//     // Read Excel file
//     const workbook = xlsx.readFile(req.file.path);
//     const sheetName = workbook.SheetNames[0];
//     const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

//     let results = [];

//     for (const row of sheet) {
//       const skuCode = row["sku"]; // Amazon column
//       const qty = parseInt(row["quantity"]); // Amazon column

//       if (!skuCode || isNaN(qty)) continue; // Skip invalid rows

//       // 1. Find SKU ID
//       const [skuRows] = await db.query(
//         "SELECT id FROM sku WHERE skuCode = ?",
//         [skuCode]
//       );

//       if (skuRows.length === 0) {
//         results.push({ skuCode, error: "SKU not found" });
//         continue;
//       }

//       const skuID = skuRows[0].id;

//       // 2. Find inventory for this SKU
//       const [invRows] = await db.query(
//         "SELECT id, quantity FROM inventory WHERE skuID = ? LIMIT 1",
//         [skuID]
//       );

//       if (invRows.length === 0) {
//         results.push({ skuCode, error: "No inventory record found" });
//         continue;
//       }

//       const inventory = invRows[0];
//       let newQty = inventory.quantity - qty;
//       if (newQty < 0) newQty = 0;

//       // 3. Update inventory
//       await db.query(
//         "UPDATE inventory SET quantity = ?, inventoryUpdatedAt = NOW() WHERE id = ?",
//         [newQty, inventory.id]
//       );

//       results.push({
//         skuCode,
//         oldQty: inventory.quantity,
//         deducted: qty,
//         newQty,
//       });
//     }

//     res.json({ message: "Amazon inventory updated", results });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Something went wrong" });
//   }
// });

// Amazon Sheet Upload - Phase 2 (Same as Meesho last phase)
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


// Flipkart Sheet Upload - Phase 1 Working - Done (same as Amazon last phase)
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

app.listen(PORT, () => {
  console.log(`Node backend running on port ${PORT}`);
});
