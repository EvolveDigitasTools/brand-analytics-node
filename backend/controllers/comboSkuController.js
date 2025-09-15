import xlsx from "xlsx";
import fs from "fs";
import db from "../db.js"; 

// Phase 1 - Currently Working - Done (Failed only when SKU is not exist)
// export const uploadComboSkuExcel = async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ success: false, message: "No file uploaded" });
//     }

//     const workbook = xlsx.readFile(req.file.path);
//     const sheetName = workbook.SheetNames[0];
//     const sheet = workbook.Sheets[sheetName];
//     const rows = xlsx.utils.sheet_to_json(sheet);

//     for (const row of rows) {
//       const mappingCode = row["Mapping SKU Code"];
//       if (!mappingCode) continue;

//       // 1️⃣ Check if combo_sku already exists
//       const [existingCombo] = await db.query(
//         "SELECT id FROM combo_sku WHERE combo_name = ?",
//         [mappingCode]
//       );

//       let comboSkuId;
//       if (existingCombo.length > 0) {
//         comboSkuId = existingCombo[0].id;
//         console.log(`Combo exists: ${mappingCode} (id=${comboSkuId})`);
//       } else {
//         // Insert new combo
//         const [comboResult] = await db.query(
//           `INSERT INTO combo_sku (combo_name) VALUES (?)`,
//           [mappingCode]
//         );
//         comboSkuId = comboResult.insertId;
//         console.log(`New combo inserted: ${mappingCode} (id=${comboSkuId})`);
//       }

//       // 2️⃣ Fetch existing child SKUs for this combo
//       const [existingItems] = await db.query(
//         `SELECT s.skuCode, csi.quantity 
//          FROM combo_sku_items csi
//          JOIN sku s ON s.id = csi.sku_id
//          WHERE csi.combo_sku_id = ?`,
//         [comboSkuId]
//       );
//       const existingSkuCodes = existingItems.map(item => item.skuCode);

//       // 3️⃣ Insert only SKUs that are not already present
//       for (let i = 1; i <= 10; i++) {
//         const skuCode = row[`SKU ${i}`];
//         const quantity = row[`Quantity ${i}`];

//         if (skuCode && quantity) {
//           if (!existingSkuCodes.includes(skuCode.toString())) {
//             await db.query(
//               `INSERT INTO combo_sku_items (combo_sku_id, sku_id, quantity)
//                VALUES (?, (SELECT id FROM sku WHERE skuCode = ?), ?)`,
//               [comboSkuId, skuCode.toString(), quantity]
//             );
//             console.log(`Added new SKU ${skuCode} to combo ${mappingCode}`);
//           } else {
//             console.log(`Skipped existing SKU ${skuCode} for combo ${mappingCode}`);
//           }
//         }
//       }
//     }

//     fs.unlinkSync(req.file.path);
//     res.json({ success: true, message: "Combo SKUs processed successfully" });

//   } catch (error) {
//     console.error("Error processing Excel:", error);
//     res.status(500).json({ success: false, message: "Error processing Excel", error });
//   }
// };

// Phase 2 - Skip those SKUs which is not exist and display log for all - Working 
// export const uploadComboSkuExcel = async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ success: false, message: "No file uploaded" });
//     }

//     const workbook = xlsx.readFile(req.file.path);
//     const sheetName = workbook.SheetNames[0];
//     const sheet = workbook.Sheets[sheetName];
//     const rows = xlsx.utils.sheet_to_json(sheet);

//     // ✅ Collect stats
//     let newCombos = 0;
//     let existingCombos = 0;
//     let newSkuItems = 0;
//     let skippedSkuItems = 0;
//     let missingSkus = [];

//     for (const row of rows) {
//       const mappingCode = row["Mapping SKU Code"];
//       if (!mappingCode) continue;

//       // 1️⃣ Check if combo_sku already exists
//       const [existingCombo] = await db.query(
//         "SELECT id FROM combo_sku WHERE combo_name = ?",
//         [mappingCode]
//       );

//       let comboSkuId;
//       if (existingCombo.length > 0) {
//         comboSkuId = existingCombo[0].id;
//         existingCombos++;
//       } else {
//         const [comboResult] = await db.query(
//           `INSERT INTO combo_sku (combo_name) VALUES (?)`,
//           [mappingCode]
//         );
//         comboSkuId = comboResult.insertId;
//         newCombos++;
//       }

//       // 2️⃣ Get existing SKUs for this combo
//       const [existingItems] = await db.query(
//         `SELECT s.skuCode 
//          FROM combo_sku_items csi
//          JOIN sku s ON s.id = csi.sku_id
//          WHERE csi.combo_sku_id = ?`,
//         [comboSkuId]
//       );
//       const existingSkuCodes = existingItems.map(item => item.skuCode);

//       // 3️⃣ Insert only new SKUs
//       for (let i = 1; i <= 10; i++) {
//         const skuCode = row[`SKU ${i}`];
//         const quantity = row[`Quantity ${i}`];

//         if (skuCode && quantity) {
//           // ✅ Check SKU exists
//           const [skuResult] = await db.query(
//             "SELECT id FROM sku WHERE skuCode = ?",
//             [skuCode.toString()]
//           );

//           if (skuResult.length === 0) {
//             missingSkus.push(skuCode);
//             skippedSkuItems++;
//             continue;
//           }

//           if (!existingSkuCodes.includes(skuCode.toString())) {
//             await db.query(
//               `INSERT INTO combo_sku_items (combo_sku_id, sku_id, quantity)
//                VALUES (?, ?, ?)`,
//               [comboSkuId, skuResult[0].id, quantity]
//             );
//             newSkuItems++;
//           } else {
//             skippedSkuItems++;
//           }
//         }
//       }
//     }

//     fs.unlinkSync(req.file.path);

//     res.json({
//       success: true,
//       message: "Combo SKUs processed successfully",
//       summary: {
//         newCombos,
//         existingCombos,
//         newSkuItems,
//         skippedSkuItems,
//         missingSkus,
//       },
//     });

//   } catch (error) {
//     console.error("Error processing Excel:", error);
//     res.status(500).json({ success: false, message: "Error processing Excel", error });
//   }
// };

// Phase 3 - Real time progess 
// export const uploadComboSkuExcel = async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ success: false, message: "No file uploaded" });
//     }

//     const workbook = xlsx.readFile(req.file.path);
//     const sheet = workbook.Sheets[workbook.SheetNames[0]];
//     const rows = xlsx.utils.sheet_to_json(sheet);

//     // total operations = number of combos * number of SKU columns
//     const totalOps = rows.length * 10;
//     let completedOps = 0;

//     // Prepare summary
//     let newCombos = 0;
//     let existingCombos = 0;
//     let newSkuItems = 0;
//     let skippedSkuItems = 0;
//     let missingSkus = [];

//     for (const row of rows) {
//       const mappingCode = row["Mapping SKU Code"];
//       if (!mappingCode) continue;

//       // check combo exists
//       const [existingCombo] = await db.query(
//         "SELECT id FROM combo_sku WHERE combo_name = ?",
//         [mappingCode]
//       );

//       let comboSkuId;
//       if (existingCombo.length > 0) {
//         comboSkuId = existingCombo[0].id;
//         existingCombos++;
//       } else {
//         const [comboResult] = await db.query(
//           "INSERT INTO combo_sku (combo_name) VALUES (?)",
//           [mappingCode]
//         );
//         comboSkuId = comboResult.insertId;
//         newCombos++;
//       }

//       const [existingItems] = await db.query(
//         `SELECT s.skuCode 
//          FROM combo_sku_items csi
//          JOIN sku s ON s.id = csi.sku_id
//          WHERE csi.combo_sku_id = ?`,
//         [comboSkuId]
//       );
//       const existingSkuCodes = existingItems.map(item => item.skuCode);

//       for (let i = 1; i <= 10; i++) {
//         completedOps++;
//         const skuCode = row[`SKU ${i}`];
//         const quantity = row[`Quantity ${i}`];

//         if (skuCode && quantity) {
//           const [skuResult] = await db.query(
//             "SELECT id FROM sku WHERE skuCode = ?",
//             [skuCode.toString()]
//           );

//           if (skuResult.length === 0) {
//             missingSkus.push(skuCode);
//             skippedSkuItems++;
//           } else if (!existingSkuCodes.includes(skuCode.toString())) {
//             await db.query(
//               `INSERT INTO combo_sku_items (combo_sku_id, sku_id, quantity)
//                VALUES (?, ?, ?)`,
//               [comboSkuId, skuResult[0].id, quantity]
//             );
//             newSkuItems++;
//           } else {
//             skippedSkuItems++;
//           }
//         }

//         // ✅ Send partial progress after each SKU is processed
//         res.write(
//           JSON.stringify({
//             type: "progress",
//             completed: completedOps,
//             total: totalOps,
//             percent: Math.round((completedOps / totalOps) * 100),
//           }) + "\n"
//         );
//       }
//     }

//     fs.unlinkSync(req.file.path);

//     res.write(
//       JSON.stringify({
//         type: "done",
//         summary: { newCombos, existingCombos, newSkuItems, skippedSkuItems, missingSkus },
//       }) + "\n"
//     );

//     res.end();
//   } catch (error) {
//     console.error("Error processing Excel:", error);
//     res.status(500).json({ success: false, message: "Error processing Excel" });
//   }
// };


// Phase - 4 Testing New Combos Working
export const uploadComboSkuExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    let newCombos = 0;
    let existingCombos = 0;
    let newSkuItems = 0;
    let skippedSkuItems = 0;
    let missingSkus = [];

    for (const row of rows) {
      const mappingCodeRaw = row["Mapping SKU Code"];
      if (!mappingCodeRaw) continue;

      // ✅ Clean combo name
      const comboName = mappingCodeRaw.toString().replace(/\u00A0/g, " ").trim();

      // 1️⃣ Check if combo exists
      const [existingCombo] = await db.query(
        "SELECT id FROM combo_sku WHERE combo_name = ?",
        [comboName]
      );

      let comboSkuId;
      if (existingCombo.length > 0) {
        comboSkuId = existingCombo[0].id;
        existingCombos++;
      } else {
        const [comboResult] = await db.query(
          "INSERT INTO combo_sku (combo_name) VALUES (?)",
          [comboName]
        );
        comboSkuId = comboResult.insertId;
        newCombos++;
      }

      // 2️⃣ Get existing child SKUs for this combo
      const [existingItems] = await db.query(
        `SELECT s.skuCode 
         FROM combo_sku_items csi
         JOIN sku s ON s.id = csi.sku_id
         WHERE csi.combo_sku_id = ?`,
        [comboSkuId]
      );
      const existingSkuCodes = existingItems.map(item => item.skuCode.trim().toUpperCase());

      // 3️⃣ Loop through SKU columns (up to 10)
      for (let i = 1; i <= 10; i++) {
        const skuRaw = row[`SKU ${i}`];
        const qtyRaw = row[`Quantity ${i}`];

        if (!skuRaw || !qtyRaw) {
          skippedSkuItems++;
          continue;
        }

        const skuCode = skuRaw.toString().trim().toUpperCase();
        const qty = Number(qtyRaw);

        if (isNaN(qty) || qty <= 0) {
          skippedSkuItems++;
          continue;
        }

        // Check if SKU exists in main SKU table
        const [skuResult] = await db.query(
          "SELECT id FROM sku WHERE TRIM(UPPER(skuCode)) = ?",
          [skuCode]
        );

        if (skuResult.length === 0) {
          missingSkus.push(skuCode);
          skippedSkuItems++;
          continue;
        }

        const skuId = skuResult[0].id;

        // Check if already added in combo
        if (!existingSkuCodes.includes(skuCode)) {
          await db.query(
            "INSERT INTO combo_sku_items (combo_sku_id, sku_id, quantity) VALUES (?, ?, ?)",
            [comboSkuId, skuId, qty]
          );
          newSkuItems++;
        } else {
          skippedSkuItems++;
        }
      }
    }

    // Delete uploaded file
    fs.unlinkSync(req.file.path);

    // Send final summary
    res.json({
      success: true,
      message: "Combo SKUs processed successfully",
      summary: { newCombos, existingCombos, newSkuItems, skippedSkuItems, missingSkus }
    });

  } catch (error) {
    console.error("Error processing Excel:", error);
    res.status(500).json({ success: false, message: "Error processing Excel", error: error.message });
  }
};


