
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
dotenv.config();

const dbConfig = { host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root", password: process.env.DB_PASS || "", database: process.env.DB_NAME || "ramom" };

async function main() {
    const connection = await mysql.createConnection(dbConfig);

    // Get tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const today = new Date().toISOString().split('T')[0];

    // Create homework for Class 1, Section A (session_id = 4 for 2024-25)
    const [result] = await connection.execute(
        `INSERT INTO homework (class_id, section_id, session_id, subject_id, date_of_homework, date_of_submission, description, create_date, created_by, sms_notification, status, branch_id, document, evaluation_date, evaluated_by, schedule_date) 
         VALUES (1, 1, 4, 1, ?, ?, 'IMPORTANT REMINDER: Please make sure to bring your copy tomorrow. This is mandatory for all students!', ?, 1, 1, '0', 1, '', NULL, 0, NULL)`,
        [today, tomorrowStr, today]
    );

    console.log(`✅ Homework created successfully! ID: ${result.insertId}`);
    console.log(`📚 Assigned to: Class 1, Section A`);
    console.log(`📅 Homework Date: ${today}`);
    console.log(`📅 Submission Date: ${tomorrowStr}`);
    console.log(`📝 Description: IMPORTANT REMINDER: Please make sure to bring your copy tomorrow. This is mandatory for all students!`);
    console.log(`📱 SMS notifications will be sent to parents.`);

    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
