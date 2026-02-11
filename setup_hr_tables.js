const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
dotenv.config();

const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "ramom"
};

async function setupHRTables() {
    const connection = await mysql.createConnection(dbConfig);

    console.log("🔧 Setting up HR & Leave Management Database Tables\n");

    try {
        // 1. Check if tables need to be created/modified
        console.log("1. Checking existing tables...");

        // Check staff_attendance
        try {
            const [attCols] = await connection.execute("SHOW COLUMNS FROM staff_attendance");
            console.log(`   ✓ staff_attendance exists with ${attCols.length} columns`);
        } catch (e) {
            console.log("   Creating staff_attendance table...");
            await connection.execute(`
                CREATE TABLE staff_attendance (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    staff_id INT NOT NULL,
                    date DATE NOT NULL,
                    status ENUM('present', 'absent', 'late', 'half_day') NOT NULL DEFAULT 'present',
                    remark TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_attendance (staff_id, date),
                    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
                )
            `);
            console.log("   ✓ Created staff_attendance table");
        }

        // Check if we need a separate leave management table
        // Since leave_application appears to be for documents, let's create staff_leave
        try {
            const [leaveCols] = await connection.execute("SHOW COLUMNS FROM staff_leave");
            console.log(`   ✓ staff_leave exists with ${leaveCols.length} columns`);
        } catch (e) {
            console.log("   Creating staff_leave table...");
            await connection.execute(`
                CREATE TABLE staff_leave (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    staff_id INT NOT NULL,
                    leave_category_id INT,
                    application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    leave_from DATE NOT NULL,
                    leave_to DATE NOT NULL,
                    reason TEXT NOT NULL,
                    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                    approved_by INT,
                    approved_date DATETIME,
                    remarks TEXT,
                    branch_id INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
                )
            `);
            console.log("   ✓ Created staff_leave table");
        }

        // Check student_leave
        try {
            const [studentLeaveCols] = await connection.execute("SHOW COLUMNS FROM student_leave");
            console.log(`   ✓ student_leave exists with ${studentLeaveCols.length} columns`);
        } catch (e) {
            console.log("   Creating student_leave table...");
            await connection.execute(`
                CREATE TABLE student_leave (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    student_id INT NOT NULL,
                    application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    leave_from DATE NOT NULL,
                    leave_to DATE NOT NULL,
                    reason TEXT NOT NULL,
                    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                    approved_by INT,
                    approved_date DATETIME,
                    remarks TEXT,
                    branch_id INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    FOREIGN KEY (student_id) REFERENCES student(id) ON DELETE CASCADE
                )
            `);
            console.log("   ✓ Created student_leave table");
        }

        // Update leave_category if needed
        try {
            const [catCols] = await connection.execute("DESCRIBE leave_category");
            const hasRoleId = catCols.some(c => c.Field === 'role_id');
            const hasDays = catCols.some(c => c.Field === 'days');
            console.log(`   ✓ leave_category exists (role_id: ${hasRoleId}, days: ${hasDays})`);

            if (!hasDays && catCols.some(c => c.Field === 'total_days')) {
                console.log("   Note: Using 'total_days' column");
            } else if (hasDays) {
                console.log("   Note: Using 'days' column");
            }
        } catch (e) {
            console.log("   Creating leave_category table...");
            await connection.execute(`
                CREATE TABLE leave_category (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    days INT NOT NULL DEFAULT 0,
                    role_id TINYINT DEFAULT NULL,
                    branch_id INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log("   ✓ Created leave_category table");
        }

        console.log("\n✅ All HR tables are ready!");
        console.log("\n📊 Tables:");
        console.log("   • staff_attendance - Staff daily attendance");
        console.log("   • staff_leave - Staff leave applications");
        console.log("   • student_leave - Student leave applications");
        console.log("   • leave_category - Leave types/categories");

    } catch (error) {
        console.error("\n❌ Error:", error.message);
        throw error;
    } finally {
        await connection.end();
    }
}

setupHRTables()
    .then(() => {
        console.log("\n🎉 HR database setup complete!");
        console.log("You can now run the comprehensive HR test.");
        process.exit(0);
    })
    .catch(err => {
        console.error("\n💥 Setup failed:", err);
        process.exit(1);
    });
