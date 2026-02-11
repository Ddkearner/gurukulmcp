
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const fs = require("fs");
dotenv.config();

const dbConfig = { host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root", password: process.env.DB_PASS || "", database: process.env.DB_NAME || "ramom" };

async function main() {
    const connection = await mysql.createConnection(dbConfig);

    // Get all product-related tables
    const [allTables] = await connection.execute("SHOW TABLES");
    const tableNames = allTables.map(t => Object.values(t)[0]);

    const keywords = ['product', 'inventory', 'purchase', 'issue', 'supplier', 'store', 'category', 'unit', 'stock'];
    const relevantTables = tableNames.filter(name =>
        keywords.some(k => name.toLowerCase().includes(k))
    );

    let output = "Inventory-related tables:\n" + relevantTables.join(", ") + "\n\n";

    // Describe each table
    for (const table of relevantTables) {
        try {
            const [schema] = await connection.execute(`DESCRIBE ${table}`);
            output += `\n${table} columns:\n`;
            schema.forEach(s => {
                output += `  ${s.Field}: ${s.Type} (Null: ${s.Null}, Default: ${s.Default})\n`;
            });

            // Get sample data
            const [sample] = await connection.execute(`SELECT * FROM ${table} LIMIT 2`);
            if (sample.length > 0) {
                output += `  Sample data: ${JSON.stringify(sample[0])}\n`;
            }
        } catch (e) {
            output += `Error describing ${table}: ${e.message}\n`;
        }
    }

    fs.writeFileSync("inventory_schema.txt", output);
    console.log(output);

    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
