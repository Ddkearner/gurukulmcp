#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types";
import axios from "axios";
import express from "express";
import cors from "cors";
import { z } from "zod";

import dotenv from "dotenv";
dotenv.config();

import { AsyncLocalStorage } from "node:async_hooks";

// Storage for request-scoped API key
const storage = new AsyncLocalStorage<string>();

// SQL Proxy Class to replace mysql2 pool
class SqlProxy {
    private apiUrl: string;
    private defaultApiKey: string;

    constructor() {
        this.apiUrl = process.env.RAMOM_API_URL || "http://localhost/ramom/mcp/sql_execute";
        this.defaultApiKey = process.env.RAMOM_API_KEY || "";
    }

    async execute(sql: string, params: any[] = []): Promise<[any, any]> {
        // Prefer request-scoped key, fall back to env var
        const apiKey = storage.getStore() || this.defaultApiKey;

        try {
            const response = await axios.post(
                this.apiUrl,
                { sql, params },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "X-API-KEY": apiKey,
                    },
                }
            );

            const data = response.data;

            // Handle CodeIgniter/PHP errors that return 200 OK but error status in JSON
            if (data.status === 'error') {
                throw new Error(data.message || 'Unknown database error');
            }

            // Create a pseudo-structure matching mysql2 [rows, fields]
            // For SELECT: data is the array of rows
            // For others: data might have affectedRows, insertId

            if (Array.isArray(data)) {
                return [data, []]; // rows, fields
            } else {
                // For INSERT/UPDATE/DELETE, mysql2 returns an 'OkPacket' object as the first element
                // and undefined as the second.
                return [data, undefined];
            }

        } catch (error: any) {
            console.error("SQL Proxy Error:", error.message);
            if (error.response) {
                console.error("Response data:", error.response.data);
            }
            throw new Error(`Database operation failed: ${error.message}`);
        }
    }
}

const pool = new SqlProxy();

const server = new Server(
    {
        name: "gurukul-ai",
        version: "1.0.0",
    },
    {
        capabilities: {
            resources: {},
            tools: {},
        },
    }
);

// Tool Definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            // --- Admission Inquiry Tools ---
            {
                name: "create_inquiry",
                description: "Create a new admission inquiry",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Name of the student/enquirer" },
                        mobile_no: { type: "string", description: "Mobile number" },
                        father_name: { type: "string", description: "Father's name" },
                        mother_name: { type: "string", description: "Mother's name" },
                        email: { type: "string", description: "Email address" },
                        address: { type: "string", description: "Address" },
                        date: { type: "string", description: "Date of inquiry (YYYY-MM-DD)" },
                        note: { type: "string", description: "Additional notes" },
                        response: { type: "string", description: "Response given" },
                        class_id: { type: "number", description: "Class ID interested in" },
                        source: { type: "string", description: "Source of inquiry" },
                        status: { type: "string", description: "Status of inquiry (e.g. active, converted, dead)" }
                    },
                    required: ["name", "mobile_no", "date"]
                }
            },
            {
                name: "read_inquiry",
                description: "Get details of an admission inquiry by ID",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"]
                }
            },
            {
                name: "update_inquiry",
                description: "Update an existing admission inquiry",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        name: { type: "string" },
                        mobile_no: { type: "string" },
                        father_name: { type: "string" },
                        mother_name: { type: "string" },
                        email: { type: "string" },
                        address: { type: "string" },
                        response: { type: "string" },
                        note: { type: "string" },
                        status: { type: "string" }
                    },
                    required: ["id"]
                }
            },
            {
                name: "list_class_marks",
                description: "Get all student marks for a specific class, section, and exam",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_id: { type: "number" },
                        section_id: { type: "number" },
                        exam_id: { type: "number" }
                    },
                    required: ["class_id", "section_id", "exam_id"]
                }
            },
            {
                name: "list_pending_fees",
                description: "List all students with unpaid fee balances",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                        class_id: { type: "number" },
                    },
                },
            },
            {
                name: "list_at_risk_students",
                description: "Identify students at high risk of leaving (Poor grades AND Unpaid fees)",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_id: { type: "number" },
                        exam_id: { type: "number" },
                    },
                    required: ["exam_id"],
                },
            },
            {
                name: "get_attendance_report",
                description: "Get attendance report for a class and section for a specific date",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_id: { type: "number" },
                        section_id: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD (defaults to today)" },
                    },
                    required: ["class_id"],
                },
            },
            {
                name: "list_top_students",
                description: "Identify best students (High marks, Paid fees, Good attendance)",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_id: { type: "number" },
                        exam_id: { type: "number" },
                    },
                    required: ["exam_id"],
                },
            },
            {
                name: "list_reception_configs",
                description: "List configuration items (purposes, types, references) for reception modules",
                inputSchema: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["call_purpose", "complaint_type", "enquiry_reference", "enquiry_response", "visitor_purpose"]
                        },
                        branch_id: { type: "number" },
                    },
                    required: ["type"],
                },
            },
            {
                name: "create_reception_config",
                description: "Add a new configuration item for a reception module",
                inputSchema: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["call_purpose", "complaint_type", "enquiry_reference", "enquiry_response", "visitor_purpose"]
                        },
                        name: { type: "string" },
                        branch_id: { type: "number" },
                    },
                    required: ["type", "name"],
                },
            },
            {
                name: "delete_reception_config",
                description: "Remove a configuration item from a reception module",
                inputSchema: {
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["call_purpose", "complaint_type", "enquiry_reference", "enquiry_response", "visitor_purpose"]
                        },
                        id: { type: "number" },
                    },
                    required: ["type", "id"],
                },
            },
            {
                name: "delete_inquiry",
                description: "Delete an admission inquiry",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"],
                },
            },
            {
                name: "bulk_delete_inquiries",
                description: "Delete multiple admission inquiries by ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        ids: {
                            type: "array",
                            items: { type: "number" },
                            description: "Array of inquiry IDs to delete"
                        }
                    },
                    required: ["ids"],
                },
            },
            {
                name: "list_inquiry_sources",
                description: "List all inquiry sources (references)",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                    },
                },
            },
            {
                name: "list_inquiry_statuses",
                description: "List all inquiry statuses (responses)",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                    },
                },
            },
            {
                name: "list_inquiries",
                description: "List admission inquiries with filters",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                        limit: { type: "number", description: "Default 50" },
                        offset: { type: "number", description: "Default 0" },
                        search: { type: "string" },
                        status: { type: "string" },
                        source_id: { type: "number" },
                        class_id: { type: "number" },
                        start_date: { type: "string", description: "YYYY-MM-DD" },
                        end_date: { type: "string", description: "YYYY-MM-DD" },
                        created_by: { type: "number" }
                    }
                }
            },
            {
                name: "create_homework",
                description: "Create a homework assignment for a class",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_id: { type: "number" },
                        section_id: { type: "number" },
                        subject_id: { type: "number" },
                        homework_date: { type: "string", description: "YYYY-MM-DD" },
                        submission_date: { type: "string", description: "YYYY-MM-DD" },
                        description: { type: "string" },
                        sms_notification: { type: "number", description: "1 for yes, 0 for no" },
                        created_by: { type: "number", description: "Staff ID" },
                    },
                    required: ["class_id", "section_id", "subject_id", "homework_date", "submission_date", "description"],
                },
            },

            // --- Accounting/Finance Tools ---
            {
                name: "list_voucher_heads",
                description: "List all voucher types/categories for income and expenses",
                inputSchema: {
                    type: "object",
                    properties: {
                        type: { type: "string", description: "Filter by type: income or expense" },
                        branch_id: { type: "number" },
                    },
                },
            },
            {
                name: "create_voucher_head",
                description: "Create a new voucher type/category",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        type: { type: "string", description: "income or expense" },
                        branch_id: { type: "number" },
                    },
                    required: ["name", "type"],
                },
            },
            {
                name: "add_income",
                description: "Record an income transaction",
                inputSchema: {
                    type: "object",
                    properties: {
                        voucher_head_id: { type: "number" },
                        amount: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        description: { type: "string" },
                        payment_method: { type: "string", description: "cash, cheque, bank transfer, etc." },
                        ref: { type: "string", description: "Reference number" },
                        account_id: { type: "string", description: "Account number" },
                    },
                    required: ["voucher_head_id", "amount", "date"],
                },
            },
            {
                name: "add_expense",
                description: "Record an expense transaction",
                inputSchema: {
                    type: "object",
                    properties: {
                        voucher_head_id: { type: "number" },
                        amount: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        description: { type: "string" },
                        payment_method: { type: "string", description: "cash, cheque, bank transfer, etc." },
                        ref: { type: "string", description: "Reference number" },
                        account_id: { type: "string", description: "Account number" },
                    },
                    required: ["voucher_head_id", "amount", "date"],
                },
            },
            {
                name: "list_transactions",
                description: "List income/expense transactions",
                inputSchema: {
                    type: "object",
                    properties: {
                        type: { type: "string", description: "Filter by income or expense" },
                        start_date: { type: "string", description: "YYYY-MM-DD" },
                        end_date: { type: "string", description: "YYYY-MM-DD" },
                        limit: { type: "number" },
                    },
                },
            },
            {
                name: "list_accounts",
                description: "List all ledger accounts with balances",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                    },
                },
            },

            // --- Inventory Management Tools ---
            // Inventory Setup
            {
                name: "list_product_categories",
                description: "List all product categories",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                    },
                },
            },
            {
                name: "create_product_category",
                description: "Create a new product category",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        branch_id: { type: "number" },
                    },
                    required: ["name", "branch_id"],
                },
            },
            {
                name: "list_product_units",
                description: "List all product units of measurement",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                    },
                },
            },
            {
                name: "create_product_unit",
                description: "Create a new product unit (Piece, Box, Kg, etc.)",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        branch_id: { type: "number" },
                    },
                    required: ["name", "branch_id"],
                },
            },
            {
                name: "list_product_stores",
                description: "List all product stores/warehouses",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                    },
                },
            },
            {
                name: "create_product_store",
                description: "Create a new product store/warehouse",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        code: { type: "string" },
                        mobileno: { type: "string" },
                        address: { type: "string" },
                        description: { type: "string" },
                        branch_id: { type: "number" },
                    },
                    required: ["name", "code"],
                },
            },
            {
                name: "list_product_suppliers",
                description: "List all product suppliers",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                    },
                },
            },
            {
                name: "create_product_supplier",
                description: "Create a new product supplier",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        company_name: { type: "string" },
                        mobileno: { type: "string" },
                        email: { type: "string" },
                        address: { type: "string" },
                        product_list: { type: "string" },
                        branch_id: { type: "number" },
                    },
                    required: ["name", "mobileno"],
                },
            },
            // Product Management
            {
                name: "list_products",
                description: "List all products with stock levels",
                inputSchema: {
                    type: "object",
                    properties: {
                        category_id: { type: "number" },
                        branch_id: { type: "number" },
                    },
                },
            },
            {
                name: "create_product",
                description: "Create a new product",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        code: { type: "string" },
                        category_id: { type: "number" },
                        purchase_unit_id: { type: "number" },
                        sales_unit_id: { type: "number" },
                        unit_ratio: { type: "string" },
                        purchase_price: { type: "number" },
                        sales_price: { type: "number" },
                        available_stock: { type: "string" },
                        remarks: { type: "string" },
                        branch_id: { type: "number" },
                    },
                    required: ["name", "code", "category_id", "purchase_unit_id", "sales_unit_id"],
                },
            },
            {
                name: "update_product_stock",
                description: "Update product stock level",
                inputSchema: {
                    type: "object",
                    properties: {
                        product_id: { type: "number" },
                        available_stock: { type: "string" },
                    },
                    required: ["product_id", "available_stock"],
                },
            },
            // Purchase Management
            {
                name: "create_purchase",
                description: "Create a purchase order",
                inputSchema: {
                    type: "object",
                    properties: {
                        bill_no: { type: "string" },
                        supplier_id: { type: "number" },
                        store_id: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        remarks: { type: "string" },
                        items: { type: "array", description: "Array of {product_id, quantity, unit_price, discount}" },
                        prepared_by: { type: "number" },
                        branch_id: { type: "number" },
                    },
                    required: ["bill_no", "supplier_id", "store_id", "date", "items"],
                },
            },
            {
                name: "list_purchases",
                description: "List purchase orders",
                inputSchema: {
                    type: "object",
                    properties: {
                        supplier_id: { type: "number" },
                        start_date: { type: "string" },
                        end_date: { type: "string" },
                        branch_id: { type: "number" },
                        limit: { type: "number" },
                    },
                },
            },
            {
                name: "get_purchase_details",
                description: "Get detailed information about a specific purchase",
                inputSchema: {
                    type: "object",
                    properties: {
                        purchase_id: { type: "number" },
                    },
                    required: ["purchase_id"],
                },
            },
            // Issue Management
            {
                name: "create_product_issue",
                description: "Issue products to staff/students",
                inputSchema: {
                    type: "object",
                    properties: {
                        role_id: { type: "number" },
                        user_id: { type: "number" },
                        date_of_issue: { type: "string", description: "YYYY-MM-DD" },
                        due_date: { type: "string", description: "YYYY-MM-DD" },
                        remarks: { type: "string" },
                        items: { type: "array", description: "Array of {product_id, quantity}" },
                        prepared_by: { type: "number" },
                        branch_id: { type: "number" },
                    },
                    required: ["role_id", "user_id", "date_of_issue", "items"],
                },
            },
            {
                name: "list_product_issues",
                description: "List product issues",
                inputSchema: {
                    type: "object",
                    properties: {
                        user_id: { type: "number" },
                        start_date: { type: "string" },
                        end_date: { type: "string" },
                        branch_id: { type: "number" },
                        limit: { type: "number" },
                    },
                },
            },

            // --- Inquiry Tools (Updated) ---
            // Removed duplicate list_inquiries definition here as it is already defined above and I updated it there.
            {
                name: "create_inquiry_follow_up",
                description: "Add a follow-up to an inquiry",
                inputSchema: {
                    type: "object",
                    properties: {
                        enquiry_id: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        next_date: { type: "string", description: "YYYY-MM-DD" },
                        response: { type: "string" },
                        note: { type: "string" },
                        status: { type: "string", description: "1: Active, 4: Closed, etc." },
                    },
                    required: ["enquiry_id", "date"],
                },
            },
            {
                name: "list_inquiry_follow_ups",
                description: "List follow-ups for a specific inquiry",
                inputSchema: {
                    type: "object",
                    properties: { enquiry_id: { type: "number" } },
                    required: ["enquiry_id"],
                },
            },

            // --- Call Log Tools ---
            {
                name: "create_call_log",
                description: "Log a new call (incoming/outgoing)",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        number: { type: "string" },
                        call_type: { type: "string", description: "Incoming or Outgoing" },
                        purpose_id: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        start_time: { type: "string", description: "HH:MM:SS" },
                        end_time: { type: "string", description: "HH:MM:SS" },
                        follow_up: { type: "string", description: "YYYY-MM-DD" },
                        note: { type: "string" },
                    },
                    required: ["name", "call_type", "date"],
                },
            },
            {
                name: "list_call_logs",
                description: "List call logs",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number" },
                        offset: { type: "number" },
                        date_from: { type: "string", description: "YYYY-MM-DD" },
                        date_to: { type: "string", description: "YYYY-MM-DD" },
                        call_type: { type: "string", enum: ["Incoming", "Outgoing"] },
                        number: { type: "string" }
                    },
                },
            },
            {
                name: "read_call_log",
                description: "Get details of a specific call log",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"],
                },
            },
            {
                name: "update_call_log",
                description: "Update a call log entry",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        name: { type: "string" },
                        number: { type: "string" },
                        call_type: { type: "string", enum: ["Incoming", "Outgoing"] },
                        purpose_id: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        start_time: { type: "string", description: "HH:MM:SS" },
                        end_time: { type: "string", description: "HH:MM:SS" },
                        follow_up: { type: "string", description: "YYYY-MM-DD" },
                        note: { type: "string" },
                    },
                    required: ["id"],
                },
            },

            {
                name: "delete_call_log",
                description: "Delete a call log entry",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"],
                },
            },
            {
                name: "bulk_delete_call_logs",
                description: "Delete multiple call logs by ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        ids: {
                            type: "array",
                            items: { type: "number" },
                            description: "Array of call log IDs to delete"
                        }
                    },
                    required: ["ids"],
                },
            },

            // --- Visitor Log Tools ---
            {
                name: "create_visitor_log",
                description: "Log a new visitor",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        number: { type: "string" },
                        purpose_id: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        entry_time: { type: "string", description: "HH:MM:SS" },
                        exit_time: { type: "string", description: "HH:MM:SS" },
                        number_of_visitor: { type: "number" },
                        id_number: { type: "string" },
                        token_pass: { type: "string" },
                        note: { type: "string" },
                    },
                    required: ["name", "date"],
                },
            },
            {
                name: "list_visitor_logs",
                description: "List visitor logs",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number" },
                        offset: { type: "number" },
                        date_from: { type: "string" },
                        date_to: { type: "string" },
                        purpose_id: { type: "number" }
                    },
                },
            },
            {
                name: "read_visitor_log",
                description: "Get details of a specific visitor log",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"],
                },
            },
            {
                name: "update_visitor_log",
                description: "Update visitor log",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        name: { type: "string" },
                        number: { type: "string" },
                        purpose_id: { type: "number" },
                        date: { type: "string" },
                        entry_time: { type: "string" },
                        exit_time: { type: "string" },
                        number_of_visitor: { type: "number" },
                        id_number: { type: "string" },
                        token_pass: { type: "string" },
                        note: { type: "string" },
                    },
                    required: ["id"],
                },
            },

            {
                name: "delete_visitor_log",
                description: "Delete a visitor log",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"],
                },
            },
            {
                name: "bulk_delete_visitor_logs",
                description: "Delete multiple visitor logs by ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        ids: {
                            type: "array",
                            items: { type: "number" },
                            description: "Array of visitor log IDs to delete"
                        }
                    },
                    required: ["ids"],
                },
            },

            // --- Complaint Tools ---
            {
                name: "create_complaint",
                description: "Log a new complaint",
                inputSchema: {
                    type: "object",
                    properties: {
                        complainant_name: { type: "string" },
                        number: { type: "string" },
                        type_id: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        assigned_id: { type: "number" },
                        note: { type: "string" },
                    },
                    required: ["complainant_name", "date"],
                },
            },
            {
                name: "list_complaints",
                description: "List complaints",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number" },
                        offset: { type: "number" },
                        type_id: { type: "number" },
                        date_from: { type: "string" },
                        date_to: { type: "string" },
                        status: { type: "string" } // Assuming there's a status or we can infer it
                    },
                },
            },
            {
                name: "read_complaint",
                description: "Get details of a specific complaint",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"],
                },
            },
            {
                name: "update_complaint",
                description: "Update complaint",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        complainant_name: { type: "string" },
                        number: { type: "string" },
                        type_id: { type: "number" },
                        date: { type: "string" },
                        assigned_id: { type: "number" },
                        action: { type: "string" },
                        date_of_solution: { type: "string" },
                        note: { type: "string" },
                    },
                    required: ["id"],
                },
            },

            {
                name: "delete_complaint",
                description: "Delete a complaint",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"],
                },
            },
            {
                name: "bulk_delete_complaints",
                description: "Delete multiple complaints by ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        ids: {
                            type: "array",
                            items: { type: "number" },
                            description: "Array of complaint IDs to delete"
                        }
                    },
                    required: ["ids"],
                },
            },

            // --- Postal Record Tools ---
            {
                name: "create_postal_record",
                description: "Log a postal record (dispatch/receive)",
                inputSchema: {
                    type: "object",
                    properties: {
                        sender_title: { type: "string" },
                        receiver_title: { type: "string" },
                        reference_no: { type: "string" },
                        address: { type: "string" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        type: { type: "string", description: "dispatch or receive" },
                        confidential: { type: "boolean" },
                        note: { type: "string" },
                    },
                    required: ["sender_title", "receiver_title", "type"],
                },
            },
            {

                name: "list_postal_records",
                description: "List postal records",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number" },
                        offset: { type: "number" },
                        type: { type: "string" },
                        date_from: { type: "string" },
                        date_to: { type: "string" }
                    },
                },
            },
            {
                name: "read_postal_record",
                description: "Get details of a specific postal record",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"],
                },
            },
            {
                name: "update_postal_record",
                description: "Update postal record",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        sender_title: { type: "string" },
                        receiver_title: { type: "string" },
                        reference_no: { type: "string" },
                        address: { type: "string" },
                        date: { type: "string" },
                        type: { type: "string" },
                        confidential: { type: "boolean" },
                        note: { type: "string" },
                    },
                    required: ["id"],
                },
            },

            {
                name: "delete_postal_record",
                description: "Delete postal record",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"],
                },
            },
            {
                name: "bulk_delete_postal_records",
                description: "Delete multiple postal records by ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        ids: {
                            type: "array",
                            items: { type: "number" },
                            description: "Array of postal record IDs to delete"
                        }
                    },
                    required: ["ids"],
                },
            },

            // --- Fees Module Tools ---
            {
                name: "create_fee_type",
                description: "Create a new fee type",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        branch_id: { type: "number" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "list_fee_types",
                description: "List fee types",
                inputSchema: {
                    type: "object",
                    properties: { branch_id: { type: "number" } }
                }
            },
            {
                name: "update_fee_type",
                description: "Update a fee type",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        name: { type: "string" },
                        description: { type: "string" }
                    },
                    required: ["id"]
                }
            },
            {
                name: "delete_fee_type",
                description: "Delete a fee type",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"]
                }
            },
            {
                name: "create_fee_group",
                description: "Create a new fee group",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        branch_id: { type: "number" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "list_fee_groups",
                description: "List fee groups",
                inputSchema: {
                    type: "object",
                    properties: { branch_id: { type: "number" } }
                }
            },
            {
                name: "add_fee_group_details",
                description: "Link fee type to group with amount and due date",
                inputSchema: {
                    type: "object",
                    properties: {
                        fee_groups_id: { type: "number" },
                        fee_type_id: { type: "number" },
                        amount: { type: "number" },
                        due_date: { type: "string", description: "YYYY-MM-DD" }
                    },
                    required: ["fee_groups_id", "fee_type_id", "amount", "due_date"]
                }
            },
            {
                name: "allocate_fees",
                description: "Assign a fee group to a student",
                inputSchema: {
                    type: "object",
                    properties: {
                        student_id: { type: "number" },
                        group_id: { type: "number" },
                        branch_id: { type: "number" },
                        prev_due: { type: "number" }
                    },
                    required: ["student_id", "group_id"]
                }
            },
            {
                name: "collect_fees",
                description: "Record a fee payment",
                inputSchema: {
                    type: "object",
                    properties: {
                        allocation_id: { type: "number" },
                        type_id: { type: "number" },
                        amount: { type: "number" },
                        discount: { type: "number" },
                        fine: { type: "number" },
                        date: { type: "string", description: "YYYY-MM-DD" },
                        method: { type: "string" },
                        pay_via: { type: "number" },
                        remarks: { type: "string" }
                    },
                    required: ["allocation_id", "type_id", "amount", "date"]
                }
            },
            {
                name: "get_student_fee_status",
                description: "Check balance and payment status for a student",
                inputSchema: {
                    type: "object",
                    properties: { student_id: { type: "number" } },
                    required: ["student_id"]
                }
            },
            {
                name: "get_fee_payment_history",
                description: "List all payment records for a specific fee allocation",
                inputSchema: {
                    type: "object",
                    properties: { allocation_id: { type: "number" } },
                    required: ["allocation_id"]
                }
            },
            {
                name: "update_fee_payment",
                description: "Edit an existing fee payment record",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        amount: { type: "number" },
                        discount: { type: "number" },
                        fine: { type: "number" },
                        date: { type: "string" },
                        remarks: { type: "string" }
                    },
                    required: ["id"]
                }
            },
            {
                name: "bulk_collect_fees",
                description: "Record payments for multiple students/allocations at once",
                inputSchema: {
                    type: "object",
                    properties: {
                        payments: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    allocation_id: { type: "number" },
                                    type_id: { type: "number" },
                                    amount: { type: "number" },
                                    date: { type: "string" }
                                },
                                required: ["allocation_id", "type_id", "amount", "date"]
                            }
                        },
                        branch_id: { type: "number" }
                    },
                    required: ["payments"]
                }
            },
            {
                name: "update_fee_allocation",
                description: "Update fee allocation details (e.g. previous due)",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        prev_due: { type: "number" }
                    },
                    required: ["id", "prev_due"]
                }
            },
            {
                name: "list_payment_methods",
                description: "List available payment methods",
                inputSchema: {
                    type: "object",
                    properties: { branch_id: { type: "number" } }
                }
            },
            {
                name: "set_fee_status",
                description: "Set fee status to Paid (by recording full payment) or Unpaid",
                inputSchema: {
                    type: "object",
                    properties: {
                        student_id: { type: "number" },
                        status: { type: "string", enum: ["Paid", "Unpaid"] },
                        date: { type: "string", description: "Date for payment if setting to Paid" }
                    },
                    required: ["student_id", "status"]
                }
            },

            // --- Examination Module Tools ---
            {
                name: "create_exam",
                description: "Create or update an exam",
                inputSchema: {
                    type: "object",
                    properties: {
                        exam_id: { type: "number" },
                        name: { type: "string" },
                        term_id: { type: "number" },
                        type_id: { type: "number" },
                        mark_distribution: { type: "array", items: { type: "number" } },
                        remark: { type: "string" },
                        branch_id: { type: "number" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "list_exams",
                description: "List exams in the current session",
                inputSchema: {
                    type: "object",
                    properties: { branch_id: { type: "number" } }
                }
            },
            {
                name: "delete_exam",
                description: "Delete an exam",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"]
                }
            },
            {
                name: "create_exam_term",
                description: "Create or update an exam term",
                inputSchema: {
                    type: "object",
                    properties: {
                        term_id: { type: "number" },
                        term_name: { type: "string" },
                        branch_id: { type: "number" }
                    },
                    required: ["term_name"]
                }
            },
            {
                name: "list_exam_terms",
                description: "List exam terms",
                inputSchema: {
                    type: "object",
                    properties: { branch_id: { type: "number" } }
                }
            },
            {
                name: "create_exam_hall",
                description: "Create or update an exam hall",
                inputSchema: {
                    type: "object",
                    properties: {
                        hall_id: { type: "number" },
                        hall_no: { type: "string" },
                        no_of_seats: { type: "number" },
                        branch_id: { type: "number" }
                    },
                    required: ["hall_no", "no_of_seats"]
                }
            },
            {
                name: "list_exam_halls",
                description: "List exam halls",
                inputSchema: {
                    type: "object",
                    properties: { branch_id: { type: "number" } }
                }
            },
            {
                name: "create_grade",
                description: "Create or update a grading system",
                inputSchema: {
                    type: "object",
                    properties: {
                        grade_id: { type: "number" },
                        name: { type: "string" },
                        grade_point: { type: "number" },
                        lower_mark: { type: "number" },
                        upper_mark: { type: "number" },
                        remark: { type: "string" },
                        branch_id: { type: "number" }
                    },
                    required: ["name", "grade_point", "lower_mark", "upper_mark"]
                }
            },
            {
                name: "list_grades",
                description: "List grading systems",
                inputSchema: {
                    type: "object",
                    properties: { branch_id: { type: "number" } }
                }
            },
            {
                name: "record_marks",
                description: "Record marks for a student in a subject for an exam",
                inputSchema: {
                    type: "object",
                    properties: {
                        student_id: { type: "number" },
                        exam_id: { type: "number" },
                        subject_id: { type: "number" },
                        class_id: { type: "number" },
                        section_id: { type: "number" },
                        mark: { type: "number" },
                        absent: { type: "boolean" }
                    },
                    required: ["student_id", "exam_id", "subject_id", "class_id", "section_id", "mark"]
                }
            },
            {
                name: "get_student_marks",
                description: "Retrieve marks for a student for a specific exam",
                inputSchema: {
                    type: "object",
                    properties: {
                        student_id: { type: "number" },
                        exam_id: { type: "number" }
                    },
                    required: ["student_id", "exam_id"]
                }
            },
            {
                name: "get_exam_timetable",
                description: "Get exam schedule for a class/section",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_id: { type: "number" },
                        section_id: { type: "number" },
                        exam_id: { type: "number" }
                    },
                    required: ["class_id", "section_id", "exam_id"]
                }
            },

            // --- Timetable Module Tools ---
            {
                name: "create_class_timetable",
                description: "Add a new entry to class schedule",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_id: { type: "number" },
                        section_id: { type: "number" },
                        subject_id: { type: "number" },
                        teacher_id: { type: "number" },
                        time_start: { type: "string" },
                        time_end: { type: "string" },
                        class_room: { type: "string" },
                        day: { type: "string", description: "Monday, Tuesday, etc." },
                        branch_id: { type: "number" },
                        is_break: { type: "boolean" }
                    },
                    required: ["class_id", "section_id", "day", "time_start", "time_end"]
                }
            },
            {
                name: "list_class_timetable",
                description: "Get full weekly schedule for a class/section",
                inputSchema: {
                    type: "object",
                    properties: {
                        class_id: { type: "number" },
                        section_id: { type: "number" }
                    },
                    required: ["class_id", "section_id"]
                }
            },
            {
                name: "delete_class_timetable",
                description: "Remove an entry from class schedule",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"]
                }
            },
            {
                name: "get_teacher_schedule",
                description: "Get all classes assigned to a teacher for the week",
                inputSchema: {
                    type: "object",
                    properties: { teacher_id: { type: "number" } },
                    required: ["teacher_id"]
                }
            },
            {
                name: "create_exam_timetable",
                description: "Add or update an entry in the exam schedule",
                inputSchema: {
                    type: "object",
                    properties: {
                        exam_id: { type: "number" },
                        class_id: { type: "number" },
                        section_id: { type: "number" },
                        subject_id: { type: "number" },
                        time_start: { type: "string" },
                        time_end: { type: "string" },
                        hall_id: { type: "number" },
                        exam_date: { type: "string", description: "YYYY-MM-DD" },
                        mark_distribution: { type: "string", description: "JSON string" },
                        branch_id: { type: "number" }
                    },
                    required: ["exam_id", "class_id", "section_id", "subject_id", "time_start", "time_end", "exam_date"]
                }
            },
            {
                name: "list_exam_timetable",
                description: "Get complete exam schedule for a specific exam and class",
                inputSchema: {
                    type: "object",
                    properties: {
                        exam_id: { type: "number" },
                        class_id: { type: "number" },
                        section_id: { type: "number" }
                    },
                    required: ["exam_id", "class_id", "section_id"]
                }
            },

            // --- Student Module Tools ---
            {
                name: "list_students",
                description: "List students with filters",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                        class_id: { type: "number" },
                        section_id: { type: "number" }
                    }
                }
            },
            {
                name: "get_student",
                description: "Get full details of a single student",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"]
                }
            },
            {
                name: "search_students",
                description: "Search students by text",
                inputSchema: {
                    type: "object",
                    properties: { search: { type: "string" } },
                    required: ["search"]
                }
            },
            {
                name: "create_student",
                description: "Create a new student record",
                inputSchema: {
                    type: "object",
                    properties: {
                        first_name: { type: "string" },
                        last_name: { type: "string" },
                        register_no: { type: "string" },
                        admission_date: { type: "string" },
                        gender: { type: "string" },
                        birthday: { type: "string" },
                        mobileno: { type: "string" },
                        email: { type: "string" },
                        parent_id: { type: "number" },
                        branch_id: { type: "number" },
                        class_id: { type: "number" },
                        section_id: { type: "number" },
                        category_id: { type: "number" },
                        religion: { type: "string" },
                        caste: { type: "string" },
                        blood_group: { type: "string" },
                        current_address: { type: "string" },
                        permanent_address: { type: "string" }
                    },
                    required: ["first_name", "last_name", "register_no", "class_id", "section_id"]
                }
            },
            {
                name: "update_student",
                description: "Update student details",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        first_name: { type: "string" },
                        last_name: { type: "string" },
                        register_no: { type: "string" },
                        admission_date: { type: "string" },
                        gender: { type: "string" },
                        birthday: { type: "string" },
                        mobileno: { type: "string" },
                        email: { type: "string" },
                        parent_id: { type: "number" },
                        class_id: { type: "number" },
                        section_id: { type: "number" },
                        category_id: { type: "number" },
                        religion: { type: "string" },
                        caste: { type: "string" },
                        blood_group: { type: "string" },
                        current_address: { type: "string" },
                        permanent_address: { type: "string" }
                    },
                    required: ["id"]
                }
            },

            // --- Parent Module Tools ---
            {
                name: "list_parents",
                description: "List parents with filters",
                inputSchema: {
                    type: "object",
                    properties: { branch_id: { type: "number" } }
                }
            },
            {
                name: "get_parent",
                description: "Get full details of a single parent",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"]
                }
            },
            {
                name: "get_parent_children",
                description: "Get all students associated with a parent",
                inputSchema: {
                    type: "object",
                    properties: { parent_id: { type: "number" } },
                    required: ["parent_id"]
                }
            },
            {
                name: "create_parent",
                description: "Create a new parent/guardian record",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Guardian Name" },
                        relation: { type: "string" },
                        father_name: { type: "string" },
                        mother_name: { type: "string" },
                        occupation: { type: "string" },
                        income: { type: "string" },
                        education: { type: "string" },
                        mobileno: { type: "string" },
                        email: { type: "string" },
                        address: { type: "string" },
                        city: { type: "string" },
                        state: { type: "string" },
                        branch_id: { type: "number" }
                    },
                    required: ["name"]
                }
            },
            {
                name: "update_parent",
                description: "Update parent details",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        name: { type: "string" },
                        relation: { type: "string" },
                        father_name: { type: "string" },
                        mother_name: { type: "string" },
                        occupation: { type: "string" },
                        income: { type: "string" },
                        education: { type: "string" },
                        mobileno: { type: "string" },
                        email: { type: "string" },
                        address: { type: "string" },
                        city: { type: "string" },
                        state: { type: "string" }
                    },
                    required: ["id"]
                }
            },

            // --- Staff Module Tools ---
            {
                name: "list_staff",
                description: "List staff members with filters",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" },
                        role_id: { type: "number" }
                    }
                }
            },
            {
                name: "get_staff",
                description: "Get full details of a single staff member",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "number" } },
                    required: ["id"]
                }
            },
            {
                name: "create_staff",
                description: "Create a new staff member",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        sex: { type: "string" },
                        designation_id: { type: "number" },
                        department_id: { type: "number" },
                        joining_date: { type: "string" },
                        mobileno: { type: "string" },
                        email: { type: "string" },
                        address: { type: "string" },
                        qualification: { type: "string" },
                        experience: { type: "string" },
                        branch_id: { type: "number" },
                        role_id: { type: "number" }
                    },
                    required: ["name", "role_id"]
                }
            },
            {
                name: "update_staff",
                description: "Update staff details",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number" },
                        name: { type: "string" },
                        sex: { type: "string" },
                        designation_id: { type: "number" },
                        department_id: { type: "number" },
                        joining_date: { type: "string" },
                        mobileno: { type: "string" },
                        email: { type: "string" },
                        address: { type: "string" },
                        qualification: { type: "string" },
                        experience: { type: "string" },
                        role_id: { type: "number" },
                        active: { type: "number", description: "1 for active, 0 for inactive" }
                    },
                    required: ["id"]
                }
            },

            // --- HR & Leave Management Tools ---
            {
                name: "mark_staff_attendance",
                description: "Mark attendance for staff member",
                inputSchema: {
                    type: "object",
                    properties: {
                        staff_id: { type: "number" },
                        date: { type: "string", description: "Date in YYYY-MM-DD format" },
                        status: { type: "string", enum: ["present", "absent", "late", "half_day"], description: "Attendance status" },
                        remarks: { type: "string" }
                    },
                    required: ["staff_id", "date", "status"]
                }
            },
            {
                name: "get_staff_attendance",
                description: "Get attendance history for a staff member",
                inputSchema: {
                    type: "object",
                    properties: {
                        staff_id: { type: "number" },
                        start_date: { type: "string" },
                        end_date: { type: "string" }
                    },
                    required: ["staff_id"]
                }
            },
            {
                name: "list_staff_attendance_report",
                description: "Get attendance report for all staff on a specific date or date range",
                inputSchema: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "Specific date or start date" },
                        end_date: { type: "string", description: "Optional end date for range" },
                        department_id: { type: "number" },
                        branch_id: { type: "number" }
                    },
                    required: ["date"]
                }
            },
            {
                name: "create_staff_leave",
                description: "Create a leave application for staff",
                inputSchema: {
                    type: "object",
                    properties: {
                        staff_id: { type: "number" },
                        leave_category_id: { type: "number" },
                        start_date: { type: "string" },
                        end_date: { type: "string" },
                        reason: { type: "string" },
                        branch_id: { type: "number" }
                    },
                    required: ["staff_id", "leave_category_id", "start_date", "end_date", "reason"]
                }
            },
            {
                name: "list_staff_leaves",
                description: "List staff leave applications with optional filters",
                inputSchema: {
                    type: "object",
                    properties: {
                        staff_id: { type: "number" },
                        status: { type: "string", enum: ["pending", "approved", "rejected"] },
                        start_date: { type: "string" },
                        end_date: { type: "string" },
                        branch_id: { type: "number" },
                        limit: { type: "number" }
                    }
                }
            },
            {
                name: "approve_staff_leave",
                description: "Approve or reject a staff leave application",
                inputSchema: {
                    type: "object",
                    properties: {
                        leave_id: { type: "number" },
                        status: { type: "string", enum: ["approved", "rejected"] },
                        remarks: { type: "string" }
                    },
                    required: ["leave_id", "status"]
                }
            },
            {
                name: "get_staff_leave_balance",
                description: "Get leave balance for a staff member",
                inputSchema: {
                    type: "object",
                    properties: {
                        staff_id: { type: "number" },
                        leave_category_id: { type: "number" }
                    },
                    required: ["staff_id"]
                }
            },
            {
                name: "create_student_leave",
                description: "Create a leave application for student",
                inputSchema: {
                    type: "object",
                    properties: {
                        student_id: { type: "number" },
                        start_date: { type: "string" },
                        end_date: { type: "string" },
                        reason: { type: "string" },
                        branch_id: { type: "number" }
                    },
                    required: ["student_id", "start_date", "end_date", "reason"]
                }
            },
            {
                name: "list_student_leaves",
                description: "List student leave applications",
                inputSchema: {
                    type: "object",
                    properties: {
                        student_id: { type: "number" },
                        class_id: { type: "number" },
                        status: { type: "string", enum: ["pending", "approved", "rejected"] },
                        start_date: { type: "string" },
                        end_date: { type: "string" },
                        branch_id: { type: "number" },
                        limit: { type: "number" }
                    }
                }
            },
            {
                name: "approve_student_leave",
                description: "Approve or reject a student leave application",
                inputSchema: {
                    type: "object",
                    properties: {
                        leave_id: { type: "number" },
                        status: { type: "string", enum: ["approved", "rejected"] },
                        remarks: { type: "string" }
                    },
                    required: ["leave_id", "status"]
                }
            },
            {
                name: "list_leave_categories",
                description: "List all leave categories/types",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" }
                    }
                }
            },
            {
                name: "create_leave_category",
                description: "Create a new leave category",
                inputSchema: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        total_days: { type: "number" },
                        branch_id: { type: "number" }
                    },
                    required: ["name", "total_days"]
                }
            },
            {
                name: "list_salary_templates",
                description: "List all available salary templates",
                inputSchema: {
                    type: "object",
                    properties: {
                        branch_id: { type: "number" }
                    }
                }
            },
            {
                name: "assign_staff_salary",
                description: "Assign a salary template to a staff member",
                inputSchema: {
                    type: "object",
                    properties: {
                        staff_id: { type: "number" },
                        salary_template_id: { type: "number" }
                    },
                    required: ["staff_id", "salary_template_id"]
                }
            }
        ],
    };
});

// Resource Definitions
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: [
            {
                uri: "inquiries://list",
                name: "Admission Inquiries",
                description: "List of all admission inquiries",
                mimeType: "application/json",
            },
            {
                uri: "staff://list",
                name: "Staff Members",
                description: "List of all staff members",
                mimeType: "application/json",
            },
            {
                uri: "students://list",
                name: "Students",
                description: "List of all enrolled students",
                mimeType: "application/json",
            }
        ],
    };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    let query = "";
    if (uri === "inquiries://list") {
        query = "SELECT * FROM enquiry LIMIT 100";
    } else if (uri === "staff://list") {
        query = "SELECT * FROM staff LIMIT 100";
    } else if (uri === "students://list") {
        query = "SELECT * FROM student LIMIT 100";
    } else {
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    }

    const [rows] = await pool.execute(query);
    return {
        contents: [
            {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(rows, null, 2),
            },
        ],
    };
});

// Tool Implementations
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case "create_inquiry": {
                const parsed = z
                    .object({
                        name: z.string(),
                        mobile_no: z.string(),
                        date: z.string(),
                        father_name: z.string().optional(),
                        mother_name: z.string().optional(),
                        email: z.string().optional(),
                        address: z.string().optional(),
                        note: z.string().optional(),
                        response: z.string().optional(),
                        class_id: z.number().optional(),
                        source: z.string().optional(),
                        status: z.string().optional(),
                    })
                    .parse(args);

                const [result] = await pool.execute(
                    `INSERT INTO enquiry 
          (name, mobile_no, date, father_name, mother_name, email, address, note, response, class_id, reference_id, status, branch_id, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        parsed.name,
                        parsed.mobile_no,
                        parsed.date,
                        parsed.father_name || null,
                        parsed.mother_name || null,
                        parsed.email || null,
                        parsed.address || null,
                        parsed.note || null,
                        parsed.response || null,
                        parsed.class_id || null,
                        parsed.source || null,
                        parsed.status || 'active', // Default status
                        1, // Default branch_id
                        1, // Default created_by (admin)
                    ]
                );

                return {
                    content: [
                        {
                            type: "text",
                            text: `Inquiry created successfully. ID: ${(result as any).insertId}`,
                        },
                    ],
                };
            }

            case "bulk_delete_inquiries": {
                const { ids } = z.object({ ids: z.array(z.number()) }).parse(args);
                if (ids.length === 0) {
                    return { content: [{ type: "text", text: "No IDs provided for deletion." }] };
                }
                const placeholders = ids.map(() => '?').join(',');
                await pool.execute(`DELETE FROM enquiry_follow_up WHERE enquiry_id IN (${placeholders})`, ids);
                const [result] = await pool.execute(`DELETE FROM enquiry WHERE id IN (${placeholders})`, ids);
                return {
                    content: [
                        {
                            type: "text",
                            text: `${(result as any).affectedRows} inquiries deleted successfully.`,
                        },
                    ],
                };
            }

            case "list_inquiry_sources": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM enquiry_reference WHERE branch_id = ?", [parsed.branch_id || 1]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "list_inquiry_statuses": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM enquiry_response WHERE branch_id = ?", [parsed.branch_id || 1]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "read_inquiry": {
                const { id } = z.object({ id: z.number() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM enquiry WHERE id = ?", [id]);
                const inquiries = rows as any[];

                if (inquiries.length === 0) {
                    throw new McpError(ErrorCode.InvalidRequest, `Inquiry with ID ${id} not found`);
                }

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(inquiries[0], null, 2),
                        },
                    ],
                };
            }

            case "update_inquiry": {
                const parsed = z
                    .object({
                        id: z.number(),
                        name: z.string().optional(),
                        mobile_no: z.string().optional(),
                        father_name: z.string().optional(),
                        mother_name: z.string().optional(),
                        email: z.string().optional(),
                        address: z.string().optional(),
                        response: z.string().optional(),
                        note: z.string().optional(),
                        status: z.string().optional(),
                    })
                    .parse(args);

                const updates: string[] = [];
                const values: any[] = [];

                if (parsed.name) { updates.push("name = ?"); values.push(parsed.name); }
                if (parsed.mobile_no) { updates.push("mobile_no = ?"); values.push(parsed.mobile_no); }
                if (parsed.father_name) { updates.push("father_name = ?"); values.push(parsed.father_name); }
                if (parsed.mother_name) { updates.push("mother_name = ?"); values.push(parsed.mother_name); }
                if (parsed.email) { updates.push("email = ?"); values.push(parsed.email); }
                if (parsed.address) { updates.push("address = ?"); values.push(parsed.address); }
                if (parsed.response) { updates.push("response = ?"); values.push(parsed.response); }
                if (parsed.note) { updates.push("note = ?"); values.push(parsed.note); }

                updates.push("updated_at = NOW()");

                if (updates.length <= 1) { // Only updated_at
                    return { content: [{ type: "text", text: "No fields to update provided." }] };
                }

                values.push(parsed.id);

                const [result] = await pool.execute(
                    `UPDATE enquiry SET ${updates.join(", ")} WHERE id = ?`,
                    values
                );

                if ((result as any).affectedRows === 0) {
                    throw new McpError(ErrorCode.InvalidRequest, `Inquiry with ID ${parsed.id} not found`);
                }

                return {
                    content: [
                        {
                            type: "text",
                            text: `Inquiry ${parsed.id} updated successfully.`,
                        },
                    ],
                };
            }

            case "delete_inquiry": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM enquiry_follow_up WHERE enquiry_id = ?", [id]);
                const [result] = await pool.execute("DELETE FROM enquiry WHERE id = ?", [id]);
                if ((result as any).affectedRows === 0) {
                    throw new McpError(ErrorCode.InvalidRequest, `Inquiry with ID ${id} not found`);
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: `Inquiry ${id} deleted successfully.`,
                        },
                    ],
                };
            }

            case "list_inquiries": {
                const parsed = z.object({
                    branch_id: z.number().optional(),
                    limit: z.number().default(50),
                    offset: z.number().default(0),
                    search: z.string().optional(),
                    status: z.string().optional(),
                    source_id: z.number().optional(),
                    class_id: z.number().optional(),
                    start_date: z.string().optional(),
                    end_date: z.string().optional(),
                    created_by: z.number().optional()
                }).parse(args);

                let query = `SELECT e.*, c.name as class_name, er.name as source_name, resp.name as status_name 
                             FROM enquiry e 
                             LEFT JOIN class c ON e.class_id = c.id 
                             LEFT JOIN enquiry_reference er ON e.reference_id = er.id 
                             LEFT JOIN enquiry_response resp ON e.response = resp.id
                             WHERE 1=1`;
                const params: any[] = [];

                if (parsed.branch_id) {
                    query += " AND e.branch_id = ?";
                    params.push(parsed.branch_id);
                }
                if (parsed.search) {
                    query += " AND (e.name LIKE ? OR e.mobile_no LIKE ? OR e.father_name LIKE ?)";
                    params.push(`%${parsed.search}%`, `%${parsed.search}%`, `%${parsed.search}%`);
                }
                if (parsed.status) {
                    query += " AND e.status = ?";
                    params.push(parsed.status);
                }
                if (parsed.source_id) {
                    query += " AND e.reference_id = ?";
                    params.push(parsed.source_id);
                }
                if (parsed.class_id) {
                    query += " AND e.class_id = ?";
                    params.push(parsed.class_id);
                }
                if (parsed.start_date) {
                    query += " AND e.date >= ?";
                    params.push(parsed.start_date);
                }
                if (parsed.end_date) {
                    query += " AND e.date <= ?";
                    params.push(parsed.end_date);
                }
                if (parsed.created_by) {
                    query += " AND e.created_by = ?";
                    params.push(parsed.created_by);
                }

                query += " ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?";
                params.push(parsed.limit, parsed.offset);

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_inquiry_follow_up": {
                const parsed = z
                    .object({
                        enquiry_id: z.number(),
                        date: z.string(),
                        next_date: z.string().optional(),
                        response: z.string().optional(),
                        note: z.string().optional(),
                        status: z.string().optional(),
                    })
                    .parse(args);

                const [result] = await pool.execute(
                    `INSERT INTO enquiry_follow_up 
                     (enquiry_id, date, next_date, response, note, status, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        parsed.enquiry_id,
                        parsed.date,
                        parsed.next_date || null,
                        parsed.response || null,
                        parsed.note || null,
                        parsed.status || null,
                    ]
                );

                return { content: [{ type: "text", text: `Follow-up created. ID: ${(result as any).insertId}` }] };
            }

            case "list_inquiry_follow_ups": {
                const { enquiry_id } = z.object({ enquiry_id: z.number() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM enquiry_follow_up WHERE enquiry_id = ? ORDER BY date DESC", [enquiry_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            // --- Accounting/Finance Implementation ---
            case "list_voucher_heads": {
                const parsed = z.object({ type: z.string().optional(), branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM voucher_head WHERE 1=1";
                const params: any[] = [];
                if (parsed.type) { query += " AND type = ?"; params.push(parsed.type); }
                if (parsed.branch_id) { query += " AND branch_id = ?"; params.push(parsed.branch_id); }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_voucher_head": {
                const parsed = z.object({ name: z.string(), type: z.string(), branch_id: z.number().optional() }).parse(args);
                const branch_id = parsed.branch_id || 1;
                const [result] = await pool.execute("INSERT INTO voucher_head (name, type, branch_id, system) VALUES (?, ?, ?, 0)", [parsed.name, parsed.type, branch_id]);
                return { content: [{ type: "text", text: `Voucher head created. ID: ${(result as any).insertId}` }] };
            }

            case "add_income": {
                const parsed = z.object({ voucher_head_id: z.number(), amount: z.number(), date: z.string(), description: z.string().optional(), payment_method: z.string().optional(), ref: z.string().optional(), account_id: z.string().optional() }).parse(args);
                const [result] = await pool.execute(`INSERT INTO transactions (voucher_head_id, type, category, amount, cr, date, description, pay_via, ref, account_id, branch_id, system, dr, bal) VALUES (?, 'income', 'income', ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0)`, [parsed.voucher_head_id, parsed.amount, parsed.amount, parsed.date, parsed.description || '', parsed.payment_method || 'cash', parsed.ref || '', parsed.account_id || '']);
                return { content: [{ type: "text", text: `Income recorded successfully. Transaction ID: ${(result as any).insertId}` }] };
            }

            case "add_expense": {
                const parsed = z.object({ voucher_head_id: z.number(), amount: z.number(), date: z.string(), description: z.string().optional(), payment_method: z.string().optional(), ref: z.string().optional(), account_id: z.string().optional() }).parse(args);
                const [result] = await pool.execute(`INSERT INTO transactions (voucher_head_id, type, category, amount, dr, date, description, pay_via, ref, account_id, branch_id, system, cr, bal) VALUES (?, 'expense', 'expense', ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0)`, [parsed.voucher_head_id, parsed.amount, parsed.amount, parsed.date, parsed.description || '', parsed.payment_method || 'cash', parsed.ref || '', parsed.account_id || '']);
                return { content: [{ type: "text", text: `Expense recorded successfully. Transaction ID: ${(result as any).insertId}` }] };
            }

            case "list_transactions": {
                const parsed = z.object({ type: z.string().optional(), start_date: z.string().optional(), end_date: z.string().optional(), limit: z.number().optional() }).parse(args);
                let query = `SELECT t.*, v.name as voucher_name FROM transactions t LEFT JOIN voucher_head v ON t.voucher_head_id = v.id WHERE 1=1`;
                const params: any[] = [];
                if (parsed.type) { query += " AND t.type = ?"; params.push(parsed.type); }
                if (parsed.start_date) { query += " AND t.date >= ?"; params.push(parsed.start_date); }
                if (parsed.end_date) { query += " AND t.date <= ?"; params.push(parsed.end_date); }
                query += " ORDER BY t.date DESC, t.id DESC";
                if (parsed.limit) { query += " LIMIT ?"; params.push(parsed.limit); } else { query += " LIMIT 50"; }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "list_accounts": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM accounts WHERE 1=1";
                const params: any[] = [];
                if (parsed.branch_id) { query += " AND branch_id = ?"; params.push(parsed.branch_id); }
                query += " ORDER BY name";
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            // --- Call Log Implementation ---
            case "create_call_log": {
                const parsed = z
                    .object({
                        name: z.string(),
                        number: z.string().optional(),
                        call_type: z.string(),
                        purpose_id: z.number().optional(),
                        date: z.string(),
                        start_time: z.string().optional(),
                        end_time: z.string().optional(),
                        follow_up: z.string().optional(),
                        note: z.string().optional(),
                    })
                    .parse(args);

                const [result] = await pool.execute(
                    `INSERT INTO call_log 
                    (name, number, call_type, purpose_id, date, start_time, end_time, follow_up, note, branch_id, created_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
                    [
                        parsed.name,
                        parsed.number || null,
                        parsed.call_type,
                        parsed.purpose_id || null,
                        parsed.date,
                        parsed.start_time || null,
                        parsed.end_time || null,
                        parsed.follow_up || null,
                        parsed.note || null,
                    ]
                );
                return { content: [{ type: "text", text: `Call log created. ID: ${(result as any).insertId}` }] };
            }

            case "list_call_logs": {
                const parsed = z.object({
                    limit: z.number().default(50),
                    offset: z.number().default(0),
                    date_from: z.string().optional(),
                    date_to: z.string().optional(),
                    call_type: z.string().optional(),
                    number: z.string().optional()
                }).parse(args);

                let query = "SELECT * FROM call_log WHERE 1=1";
                const params: any[] = [];

                if (parsed.date_from) {
                    query += " AND date >= ?";
                    params.push(parsed.date_from);
                }
                if (parsed.date_to) {
                    query += " AND date <= ?";
                    params.push(parsed.date_to);
                }
                if (parsed.call_type) {
                    query += " AND call_type = ?";
                    params.push(parsed.call_type);
                }
                if (parsed.number) {
                    query += " AND number LIKE ?";
                    params.push(`%${parsed.number}%`);
                }

                query += " ORDER BY date DESC, id DESC LIMIT ? OFFSET ?";
                params.push(parsed.limit, parsed.offset);

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "read_call_log": {
                const { id } = z.object({ id: z.number() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM call_log WHERE id = ?", [id]);
                if ((rows as any[]).length === 0) {
                    throw new McpError(ErrorCode.InvalidRequest, `Call log with ID ${id} not found`);
                }
                return { content: [{ type: "text", text: JSON.stringify((rows as any[])[0], null, 2) }] };
            }

            case "update_call_log": {
                const parsed = z.object({
                    id: z.number(),
                    name: z.string().optional(),
                    number: z.string().optional(),
                    call_type: z.string().optional(),
                    purpose_id: z.number().optional(),
                    date: z.string().optional(),
                    start_time: z.string().optional(),
                    end_time: z.string().optional(),
                    follow_up: z.string().optional(),
                    note: z.string().optional(),
                }).parse(args);

                const updates: string[] = [];
                const values: any[] = [];

                if (parsed.name) { updates.push("name = ?"); values.push(parsed.name); }
                if (parsed.number) { updates.push("number = ?"); values.push(parsed.number); }
                if (parsed.call_type) { updates.push("call_type = ?"); values.push(parsed.call_type); }
                if (parsed.purpose_id) { updates.push("purpose_id = ?"); values.push(parsed.purpose_id); }
                if (parsed.date) { updates.push("date = ?"); values.push(parsed.date); }
                if (parsed.start_time) { updates.push("start_time = ?"); values.push(parsed.start_time); }
                if (parsed.end_time) { updates.push("end_time = ?"); values.push(parsed.end_time); }
                if (parsed.follow_up) { updates.push("follow_up = ?"); values.push(parsed.follow_up); }
                if (parsed.note) { updates.push("note = ?"); values.push(parsed.note); }

                if (updates.length > 0) {
                    updates.push("updated_at = NOW()");
                    values.push(parsed.id);
                    await pool.execute(`UPDATE call_log SET ${updates.join(", ")} WHERE id = ?`, values);
                    return { content: [{ type: "text", text: `Call log ${parsed.id} updated.` }] };
                }
                return { content: [{ type: "text", text: "No updates provided." }] };
            }

            case "delete_call_log": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM call_log WHERE id = ?", [id]);
                return { content: [{ type: "text", text: `Call log ${id} deleted.` }] };
            }

            case "bulk_delete_call_logs": {
                const { ids } = z.object({ ids: z.array(z.number()) }).parse(args);
                if (ids.length === 0) {
                    return { content: [{ type: "text", text: "No IDs provided for deletion." }] };
                }
                const placeholders = ids.map(() => '?').join(',');
                const [result] = await pool.execute(`DELETE FROM call_log WHERE id IN (${placeholders})`, ids);
                return {
                    content: [
                        {
                            type: "text",
                            text: `${(result as any).affectedRows} call logs deleted successfully.`,
                        },
                    ],
                };
            }

            // --- Visitor Log Implementation ---
            case "create_visitor_log": {
                const parsed = z.object({
                    name: z.string(),
                    number: z.string().optional(),
                    purpose_id: z.number().optional(),
                    date: z.string(),
                    entry_time: z.string().optional(),
                    exit_time: z.string().optional(),
                    number_of_visitor: z.number().optional(),
                    id_number: z.string().optional(),
                    token_pass: z.string().optional(),
                    note: z.string().optional(),
                }).parse(args);

                const [result] = await pool.execute(
                    `INSERT INTO visitor_log 
                    (name, number, purpose_id, date, entry_time, exit_time, number_of_visitor, id_number, token_pass, note, branch_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
                    [parsed.name, parsed.number || null, parsed.purpose_id || null, parsed.date, parsed.entry_time || null, parsed.exit_time || null, parsed.number_of_visitor || null, parsed.id_number || null, parsed.token_pass || null, parsed.note || null]
                );
                return { content: [{ type: "text", text: `Visitor log created. ID: ${(result as any).insertId}` }] };
            }

            case "list_visitor_logs": {
                const parsed = z.object({
                    limit: z.number().default(50),
                    offset: z.number().default(0),
                    date_from: z.string().optional(),
                    date_to: z.string().optional(),
                    purpose_id: z.number().optional()
                }).parse(args);

                let query = "SELECT * FROM visitor_log WHERE 1=1";
                const params: any[] = [];

                if (parsed.date_from) {
                    query += " AND date >= ?";
                    params.push(parsed.date_from);
                }
                if (parsed.date_to) {
                    query += " AND date <= ?";
                    params.push(parsed.date_to);
                }
                if (parsed.purpose_id) {
                    query += " AND purpose_id = ?";
                    params.push(parsed.purpose_id);
                }

                query += " ORDER BY date DESC, id DESC LIMIT ? OFFSET ?";
                params.push(parsed.limit, parsed.offset);

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "read_visitor_log": {
                const { id } = z.object({ id: z.number() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM visitor_log WHERE id = ?", [id]);
                if ((rows as any[]).length === 0) {
                    throw new McpError(ErrorCode.InvalidRequest, `Visitor log with ID ${id} not found`);
                }
                return { content: [{ type: "text", text: JSON.stringify((rows as any[])[0], null, 2) }] };
            }

            case "update_visitor_log": {
                const parsed = z.object({
                    id: z.number(),
                    name: z.string().optional(),
                    number: z.string().optional(),
                    purpose_id: z.number().optional(),
                    date: z.string().optional(),
                    entry_time: z.string().optional(),
                    exit_time: z.string().optional(),
                    number_of_visitor: z.number().optional(),
                    id_number: z.string().optional(),
                    token_pass: z.string().optional(),
                    note: z.string().optional(),
                }).parse(args);

                const updates: string[] = [];
                const values: any[] = [];

                if (parsed.name) { updates.push("name = ?"); values.push(parsed.name); }
                if (parsed.number) { updates.push("number = ?"); values.push(parsed.number); }
                if (parsed.purpose_id) { updates.push("purpose_id = ?"); values.push(parsed.purpose_id); }
                if (parsed.date) { updates.push("date = ?"); values.push(parsed.date); }
                if (parsed.entry_time) { updates.push("entry_time = ?"); values.push(parsed.entry_time); }
                if (parsed.exit_time) { updates.push("exit_time = ?"); values.push(parsed.exit_time); }
                if (parsed.number_of_visitor) { updates.push("number_of_visitor = ?"); values.push(parsed.number_of_visitor); }
                if (parsed.id_number) { updates.push("id_number = ?"); values.push(parsed.id_number); }
                if (parsed.token_pass) { updates.push("token_pass = ?"); values.push(parsed.token_pass); }
                if (parsed.note) { updates.push("note = ?"); values.push(parsed.note); }

                if (updates.length > 0) {
                    values.push(parsed.id);
                    await pool.execute(`UPDATE visitor_log SET ${updates.join(", ")} WHERE id = ?`, values);
                    return { content: [{ type: "text", text: `Visitor log ${parsed.id} updated.` }] };
                }
                return { content: [{ type: "text", text: "No updates provided." }] };
            }

            case "delete_visitor_log": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM visitor_log WHERE id = ?", [id]);
                return { content: [{ type: "text", text: `Visitor log ${id} deleted.` }] };
            }

            case "bulk_delete_visitor_logs": {
                const { ids } = z.object({ ids: z.array(z.number()) }).parse(args);
                if (ids.length === 0) {
                    return { content: [{ type: "text", text: "No IDs provided for deletion." }] };
                }
                const placeholders = ids.map(() => '?').join(',');
                const [result] = await pool.execute(`DELETE FROM visitor_log WHERE id IN (${placeholders})`, ids);
                return {
                    content: [
                        {
                            type: "text",
                            text: `${(result as any).affectedRows} visitor logs deleted successfully.`,
                        },
                    ],
                };
            }

            // --- Complaint Implementation ---
            case "create_complaint": {
                const parsed = z.object({
                    complainant_name: z.string(),
                    number: z.string().optional(),
                    type_id: z.number().optional(),
                    date: z.string(),
                    assigned_id: z.number().optional(),
                    note: z.string().optional(),
                }).parse(args);

                const [result] = await pool.execute(
                    `INSERT INTO complaint 
                    (name, number, type_id, date, assigned_id, note, branch_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
                    [parsed.complainant_name, parsed.number || null, parsed.type_id || null, parsed.date, parsed.assigned_id || null, parsed.note || null]
                );
                return { content: [{ type: "text", text: `Complaint created. ID: ${(result as any).insertId}` }] };
            }

            case "list_complaints": {
                const parsed = z.object({
                    limit: z.number().default(50),
                    offset: z.number().default(0),
                    type_id: z.number().optional(),
                    date_from: z.string().optional(),
                    date_to: z.string().optional(),
                    status: z.string().optional()
                }).parse(args);

                let query = "SELECT * FROM complaint WHERE 1=1";
                const params: any[] = [];

                if (parsed.type_id) { query += " AND type_id = ?"; params.push(parsed.type_id); }
                if (parsed.date_from) { query += " AND date >= ?"; params.push(parsed.date_from); }
                if (parsed.date_to) { query += " AND date <= ?"; params.push(parsed.date_to); }
                // if (parsed.status) { query += " AND status = ?"; params.push(parsed.status); } // Uncomment if status column exists

                query += " ORDER BY date DESC, id DESC LIMIT ? OFFSET ?";
                params.push(parsed.limit, parsed.offset);

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "read_complaint": {
                const { id } = z.object({ id: z.number() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM complaint WHERE id = ?", [id]);
                if ((rows as any[]).length === 0) {
                    throw new McpError(ErrorCode.InvalidRequest, `Complaint with ID ${id} not found`);
                }
                return { content: [{ type: "text", text: JSON.stringify((rows as any[])[0], null, 2) }] };
            }

            case "update_complaint": {
                const parsed = z.object({
                    id: z.number(),
                    complainant_name: z.string().optional(),
                    number: z.string().optional(),
                    type_id: z.number().optional(),
                    date: z.string().optional(),
                    assigned_id: z.number().optional(),
                    action: z.string().optional(),
                    date_of_solution: z.string().optional(),
                    note: z.string().optional(),
                }).parse(args);

                const updates: string[] = [];
                const values: any[] = [];

                if (parsed.complainant_name) { updates.push("name = ?"); values.push(parsed.complainant_name); }
                if (parsed.number) { updates.push("number = ?"); values.push(parsed.number); }
                if (parsed.type_id) { updates.push("type_id = ?"); values.push(parsed.type_id); }
                if (parsed.date) { updates.push("date = ?"); values.push(parsed.date); }
                if (parsed.assigned_id) { updates.push("assigned_id = ?"); values.push(parsed.assigned_id); }
                if (parsed.action) { updates.push("action = ?"); values.push(parsed.action); }
                if (parsed.date_of_solution) { updates.push("date_of_solution = ?"); values.push(parsed.date_of_solution); }
                if (parsed.note) { updates.push("note = ?"); values.push(parsed.note); }

                if (updates.length > 0) {
                    values.push(parsed.id);
                    await pool.execute(`UPDATE complaint SET ${updates.join(", ")} WHERE id = ?`, values);
                    return { content: [{ type: "text", text: `Complaint ${parsed.id} updated.` }] };
                }
                return { content: [{ type: "text", text: "No updates provided." }] };
            }

            case "delete_complaint": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM complaint WHERE id = ?", [id]);
                return { content: [{ type: "text", text: `Complaint ${id} deleted.` }] };
            }

            case "bulk_delete_complaints": {
                const { ids } = z.object({ ids: z.array(z.number()) }).parse(args);
                if (ids.length === 0) {
                    return { content: [{ type: "text", text: "No IDs provided for deletion." }] };
                }
                const placeholders = ids.map(() => '?').join(',');
                const [result] = await pool.execute(`DELETE FROM complaint WHERE id IN (${placeholders})`, ids);
                return {
                    content: [
                        {
                            type: "text",
                            text: `${(result as any).affectedRows} complaints deleted successfully.`,
                        },
                    ],
                };
            }

            // --- Postal Record Implementation ---
            case "create_postal_record": {
                const parsed = z.object({
                    sender_title: z.string(),
                    receiver_title: z.string(),
                    reference_no: z.string().optional(),
                    address: z.string().optional(),
                    date: z.string(),
                    type: z.string(),
                    confidential: z.boolean().optional(),
                    note: z.string().optional(),
                }).parse(args);

                const [result] = await pool.execute(
                    `INSERT INTO postal_record 
                    (sender_title, receiver_title, reference_no, address, date, type, confidential, note, branch_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
                    [parsed.sender_title, parsed.receiver_title, parsed.reference_no || null, parsed.address || null, parsed.date, parsed.type, parsed.confidential ? 1 : 0, parsed.note || null]
                );
                return { content: [{ type: "text", text: `Postal record created. ID: ${(result as any).insertId}` }] };
            }

            case "list_postal_records": {
                const parsed = z.object({
                    limit: z.number().default(50),
                    offset: z.number().default(0),
                    type: z.string().optional(),
                    date_from: z.string().optional(),
                    date_to: z.string().optional()
                }).parse(args);

                let query = "SELECT * FROM postal_record WHERE 1=1";
                const params: any[] = [];

                if (parsed.type) { query += " AND type = ?"; params.push(parsed.type); }
                if (parsed.date_from) { query += " AND date >= ?"; params.push(parsed.date_from); }
                if (parsed.date_to) { query += " AND date <= ?"; params.push(parsed.date_to); }

                query += " ORDER BY date DESC, id DESC LIMIT ? OFFSET ?";
                params.push(parsed.limit, parsed.offset);

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "read_postal_record": {
                const { id } = z.object({ id: z.number() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM postal_record WHERE id = ?", [id]);
                if ((rows as any[]).length === 0) {
                    throw new McpError(ErrorCode.InvalidRequest, `Postal record with ID ${id} not found`);
                }
                return { content: [{ type: "text", text: JSON.stringify((rows as any[])[0], null, 2) }] };
            }

            case "update_postal_record": {
                const parsed = z.object({
                    id: z.number(),
                    sender_title: z.string().optional(),
                    receiver_title: z.string().optional(),
                    reference_no: z.string().optional(),
                    address: z.string().optional(),
                    date: z.string().optional(),
                    type: z.string().optional(),
                    confidential: z.boolean().optional(),
                    note: z.string().optional(),
                }).parse(args);

                const updates: string[] = [];
                const values: any[] = [];

                if (parsed.sender_title) { updates.push("sender_title = ?"); values.push(parsed.sender_title); }
                if (parsed.receiver_title) { updates.push("receiver_title = ?"); values.push(parsed.receiver_title); }
                if (parsed.reference_no) { updates.push("reference_no = ?"); values.push(parsed.reference_no); }
                if (parsed.address) { updates.push("address = ?"); values.push(parsed.address); }
                if (parsed.date) { updates.push("date = ?"); values.push(parsed.date); }
                if (parsed.type) { updates.push("type = ?"); values.push(parsed.type); }
                if (parsed.confidential !== undefined) { updates.push("confidential = ?"); values.push(parsed.confidential ? 1 : 0); }
                if (parsed.note) { updates.push("note = ?"); values.push(parsed.note); }

                if (updates.length > 0) {
                    values.push(parsed.id);
                    await pool.execute(`UPDATE postal_record SET ${updates.join(", ")} WHERE id = ?`, values);
                    return { content: [{ type: "text", text: `Postal record ${parsed.id} updated.` }] };
                }
                return { content: [{ type: "text", text: "No updates provided." }] };
            }

            case "delete_postal_record": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM postal_record WHERE id = ?", [id]);
                return { content: [{ type: "text", text: `Postal record ${id} deleted.` }] };
            }

            case "bulk_delete_postal_records": {
                const { ids } = z.object({ ids: z.array(z.number()) }).parse(args);
                if (ids.length === 0) {
                    return { content: [{ type: "text", text: "No IDs provided for deletion." }] };
                }
                const placeholders = ids.map(() => '?').join(',');
                const [result] = await pool.execute(`DELETE FROM postal_record WHERE id IN (${placeholders})`, ids);
                return {
                    content: [
                        {
                            type: "text",
                            text: `${(result as any).affectedRows} postal records deleted successfully.`,
                        },
                    ],
                };
            }

            // --- Inventory Management Implementation ---
            // Inventory Setup Handlers
            case "list_product_categories": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM product_category WHERE 1=1";
                const params: any[] = [];
                if (parsed.branch_id) {
                    query += " AND branch_id = ?";
                    params.push(parsed.branch_id);
                }
                query += " ORDER BY name";
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_product_category": {
                const parsed = z.object({ name: z.string(), branch_id: z.number().optional() }).parse(args);
                const branch_id = parsed.branch_id || 1;
                const [result] = await pool.execute(
                    "INSERT INTO product_category (name, branch_id) VALUES (?, ?)",
                    [parsed.name, branch_id]
                );
                return { content: [{ type: "text", text: `Product category created. ID: ${(result as any).insertId}` }] };
            }

            case "list_product_units": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM product_unit WHERE 1=1";
                const params: any[] = [];
                if (parsed.branch_id) {
                    query += " AND branch_id = ?";
                    params.push(parsed.branch_id);
                }
                query += " ORDER BY name";
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_product_unit": {
                const parsed = z.object({ name: z.string(), branch_id: z.number().optional() }).parse(args);
                const branch_id = parsed.branch_id || 1;
                const [result] = await pool.execute(
                    "INSERT INTO product_unit (name, branch_id) VALUES (?, ?)",
                    [parsed.name, branch_id]
                );
                return { content: [{ type: "text", text: `Product unit created. ID: ${(result as any).insertId}` }] };
            }

            case "list_product_stores": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM product_store WHERE 1=1";
                const params: any[] = [];
                if (parsed.branch_id) {
                    query += " AND branch_id = ?";
                    params.push(parsed.branch_id);
                }
                query += " ORDER BY name";
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_product_store": {
                const parsed = z.object({
                    name: z.string(),
                    code: z.string(),
                    mobileno: z.string().optional(),
                    address: z.string().optional(),
                    description: z.string().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;
                const [result] = await pool.execute(
                    "INSERT INTO product_store (name, code, mobileno, address, description, branch_id) VALUES (?, ?, ?, ?, ?, ?)",
                    [parsed.name, parsed.code, parsed.mobileno || '', parsed.address || '', parsed.description || '', branch_id]
                );
                return { content: [{ type: "text", text: `Product store created. ID: ${(result as any).insertId}` }] };
            }

            case "list_product_suppliers": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM product_supplier WHERE 1=1";
                const params: any[] = [];
                if (parsed.branch_id) {
                    query += " AND branch_id = ?";
                    params.push(parsed.branch_id);
                }
                query += " ORDER BY name";
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_product_supplier": {
                const parsed = z.object({
                    name: z.string(),
                    company_name: z.string().optional(),
                    mobileno: z.string(),
                    email: z.string().optional(),
                    address: z.string().optional(),
                    product_list: z.string().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;
                const [result] = await pool.execute(
                    "INSERT INTO product_supplier (name, company_name, mobileno, email, address, product_list, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [parsed.name, parsed.company_name || '', parsed.mobileno, parsed.email || '', parsed.address || '', parsed.product_list || '', branch_id]
                );
                return { content: [{ type: "text", text: `Product supplier created. ID: ${(result as any).insertId}` }] };
            }

            // Product Management Handlers
            case "list_products": {
                const parsed = z.object({
                    category_id: z.number().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                let query = `SELECT p.*, c.name as category_name, 
                 pu.name as purchase_unit_name, su.name as sales_unit_name
                 FROM product p
                 LEFT JOIN product_category c ON p.category_id = c.id
                 LEFT JOIN product_unit pu ON p.purchase_unit_id = pu.id
                 LEFT JOIN product_unit su ON p.sales_unit_id = su.id
                 WHERE 1=1`;
                const params: any[] = [];
                if (parsed.category_id) {
                    query += " AND p.category_id = ?";
                    params.push(parsed.category_id);
                }
                if (parsed.branch_id) {
                    query += " AND p.branch_id = ?";
                    params.push(parsed.branch_id);
                }
                query += " ORDER BY p.name";
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_product": {
                const parsed = z.object({
                    name: z.string(),
                    code: z.string(),
                    category_id: z.number(),
                    purchase_unit_id: z.number(),
                    sales_unit_id: z.number(),
                    unit_ratio: z.string().optional(),
                    purchase_price: z.number().optional(),
                    sales_price: z.number().optional(),
                    available_stock: z.string().optional(),
                    remarks: z.string().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;
                const [result] = await pool.execute(
                    `INSERT INTO product (name, code, category_id, purchase_unit_id, sales_unit_id, unit_ratio, purchase_price, sales_price, available_stock, remarks, branch_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [parsed.name, parsed.code, parsed.category_id, parsed.purchase_unit_id, parsed.sales_unit_id,
                    parsed.unit_ratio || '1', parsed.purchase_price || 0, parsed.sales_price || 0,
                    parsed.available_stock || '0', parsed.remarks || '', branch_id]
                );
                return { content: [{ type: "text", text: `Product created. ID: ${(result as any).insertId}` }] };
            }

            case "update_product_stock": {
                const parsed = z.object({
                    product_id: z.number(),
                    available_stock: z.string()
                }).parse(args);
                await pool.execute(
                    "UPDATE product SET available_stock = ? WHERE id = ?",
                    [parsed.available_stock, parsed.product_id]
                );
                return { content: [{ type: "text", text: `Product stock updated successfully.` }] };
            }

            // Purchase Management Handlers
            case "create_purchase": {
                const parsed = z.object({
                    bill_no: z.string(),
                    supplier_id: z.number(),
                    store_id: z.number(),
                    date: z.string(),
                    remarks: z.string().optional(),
                    items: z.array(z.any()),
                    prepared_by: z.number().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;

                // Calculate totals
                let total = 0;
                for (const item of parsed.items) {
                    const subtotal = (item.quantity * item.unit_price) - (item.discount || 0);
                    total += subtotal;
                }

                // Insert purchase bill
                const [billResult] = await pool.execute(
                    `INSERT INTO purchase_bill (bill_no, supplier_id, store_id, date, remarks, total, discount, paid, due, payment_status, purchase_status, prepared_by, branch_id) 
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 1, 1, ?, ?)`,
                    [parsed.bill_no, parsed.supplier_id, parsed.store_id, parsed.date, parsed.remarks || '', total, total, parsed.prepared_by || 1, branch_id]
                );

                const billId = (billResult as any).insertId;

                // Insert purchase details
                for (const item of parsed.items) {
                    const subtotal = (item.quantity * item.unit_price) - (item.discount || 0);
                    await pool.execute(
                        "INSERT INTO purchase_bill_details (purchase_bill_id, product_id, unit_price, quantity, discount, sub_total) VALUES (?, ?, ?, ?, ?, ?)",
                        [billId, item.product_id, item.unit_price, item.quantity, item.discount || 0, subtotal]
                    );

                    // Update product stock
                    await pool.execute(
                        "UPDATE product SET available_stock = available_stock + ? WHERE id = ?",
                        [item.quantity, item.product_id]
                    );
                }

                return { content: [{ type: "text", text: `Purchase order created. Bill ID: ${billId}` }] };
            }

            case "list_purchases": {
                const parsed = z.object({
                    supplier_id: z.number().optional(),
                    start_date: z.string().optional(),
                    end_date: z.string().optional(),
                    branch_id: z.number().optional(),
                    limit: z.number().optional()
                }).parse(args);

                let query = `SELECT pb.*, ps.name as supplier_name, pst.name as store_name
                 FROM purchase_bill pb
                 LEFT JOIN product_supplier ps ON pb.supplier_id = ps.id
                 LEFT JOIN product_store pst ON pb.store_id = pst.id
                 WHERE 1=1`;
                const params: any[] = [];

                if (parsed.supplier_id) {
                    query += " AND pb.supplier_id = ?";
                    params.push(parsed.supplier_id);
                }
                if (parsed.start_date) {
                    query += " AND pb.date >= ?";
                    params.push(parsed.start_date);
                }
                if (parsed.end_date) {
                    query += " AND pb.date <= ?";
                    params.push(parsed.end_date);
                }
                if (parsed.branch_id) {
                    query += " AND pb.branch_id = ?";
                    params.push(parsed.branch_id);
                }

                query += " ORDER BY pb.date DESC, pb.id DESC";

                if (parsed.limit) {
                    query += " LIMIT ?";
                    params.push(parsed.limit);
                } else {
                    query += " LIMIT 50";
                }

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "get_purchase_details": {
                const parsed = z.object({ purchase_id: z.number() }).parse(args);

                const [bill] = await pool.execute(
                    `SELECT pb.*, ps.name as supplier_name, pst.name as store_name
         FROM purchase_bill pb
         LEFT JOIN product_supplier ps ON pb.supplier_id = ps.id
         LEFT JOIN product_store pst ON pb.store_id = pst.id
         WHERE pb.id = ?`,
                    [parsed.purchase_id]
                );

                const [details] = await pool.execute(
                    `SELECT pbd.*, p.name as product_name
         FROM purchase_bill_details pbd
        LEFT JOIN product p ON pbd.product_id = p.id
         WHERE pbd.purchase_bill_id = ?`,
                    [parsed.purchase_id]
                );

                return { content: [{ type: "text", text: JSON.stringify({ bill: (bill as any[])[0], items: details }, null, 2) }] };
            }

            // Issue Management Handlers
            case "create_product_issue": {
                const parsed = z.object({
                    role_id: z.number(),
                    user_id: z.number(),
                    date_of_issue: z.string(),
                    due_date: z.string().optional(),
                    remarks: z.string().optional(),
                    items: z.array(z.any()),
                    prepared_by: z.number().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;

                // Insert issue header
                const [issueResult] = await pool.execute(
                    `INSERT INTO product_issues (role_id, user_id, date_of_issue, due_date, remarks, prepared_by, status, branch_id) 
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
                    [parsed.role_id, parsed.user_id, parsed.date_of_issue, parsed.due_date || null, parsed.remarks || '', parsed.prepared_by || 1, branch_id]
                );

                const issueId = (issueResult as any).insertId;

                // Insert issue details and update stock
                for (const item of parsed.items) {
                    await pool.execute(
                        "INSERT INTO product_issues_details (issues_id, product_id, quantity) VALUES (?, ?, ?)",
                        [issueId, item.product_id, item.quantity]
                    );

                    // Decrease product stock
                    await pool.execute(
                        "UPDATE product SET available_stock = available_stock - ? WHERE id = ?",
                        [item.quantity, item.product_id]
                    );
                }

                return { content: [{ type: "text", text: `Product issue created. Issue ID: ${issueId}` }] };
            }

            case "list_product_issues": {
                const parsed = z.object({
                    user_id: z.number().optional(),
                    start_date: z.string().optional(),
                    end_date: z.string().optional(),
                    branch_id: z.number().optional(),
                    limit: z.number().optional()
                }).parse(args);

                let query = `SELECT pi.* FROM product_issues pi WHERE 1=1`;
                const params: any[] = [];

                if (parsed.user_id) {
                    query += " AND pi.user_id = ?";
                    params.push(parsed.user_id);
                }
                if (parsed.start_date) {
                    query += " AND pi.date_of_issue >= ?";
                    params.push(parsed.start_date);
                }
                if (parsed.end_date) {
                    query += " AND pi.date_of_issue <= ?";
                    params.push(parsed.end_date);
                }
                if (parsed.branch_id) {
                    query += " AND pi.branch_id = ?";
                    params.push(parsed.branch_id);
                }

                query += " ORDER BY pi.date_of_issue DESC, pi.id DESC";

                if (parsed.limit) {
                    query += " LIMIT ?";
                    params.push(parsed.limit);
                } else {
                    query += " LIMIT 50";
                }

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }



            // --- HR & Leave Management Implementation ---

            // Updated HR & Leave Management Handlers

            // Staff Attendance Handlers
            case "mark_staff_attendance": {
                const parsed = z.object({
                    staff_id: z.number(),
                    date: z.string(),
                    status: z.enum(["present", "absent", "late", "half_day"]),
                    remarks: z.string().optional()
                }).parse(args);

                await pool.execute(
                    `INSERT INTO staff_attendance (staff_id, date, status, remark) 
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = ?, remark = ?`,
                    [parsed.staff_id, parsed.date, parsed.status, parsed.remarks || '', parsed.status, parsed.remarks || '']
                );
                return { content: [{ type: "text", text: `Staff attendance marked for ${parsed.date}` }] };
            }

            case "get_staff_attendance": {
                const parsed = z.object({
                    staff_id: z.number(),
                    start_date: z.string().optional(),
                    end_date: z.string().optional()
                }).parse(args);

                let query = `SELECT sa.*, s.name as staff_name 
                 FROM staff_attendance sa
                 LEFT JOIN staff s ON sa.staff_id = s.id
                 WHERE sa.staff_id = ?`;
                const params: any[] = [parsed.staff_id];

                if (parsed.start_date) {
                    query += " AND sa.date >= ?";
                    params.push(parsed.start_date);
                }
                if (parsed.end_date) {
                    query += " AND sa.date <= ?";
                    params.push(parsed.end_date);
                }

                query += " ORDER BY sa.date DESC";

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "list_staff_attendance_report": {
                const parsed = z.object({
                    date: z.string(),
                    end_date: z.string().optional(),
                    department_id: z.number().optional(),
                    branch_id: z.number().optional()
                }).parse(args);

                let query = `SELECT sa.*, s.name as staff_name, s.designation, s.department
                 FROM staff_attendance sa
                 LEFT JOIN staff s ON sa.staff_id = s.id
                 WHERE sa.date >= ?`;
                const params: any[] = [parsed.date];

                if (parsed.end_date) {
                    query += " AND sa.date <= ?";
                    params.push(parsed.end_date);
                }
                if (parsed.department_id) {
                    query += " AND s.department = ?";
                    params.push(parsed.department_id);
                }
                if (parsed.branch_id) {
                    query += " AND s.branch_id = ?";
                    params.push(parsed.branch_id);
                }

                query += " ORDER BY sa.date DESC, s.name";

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            // Staff Leave Management Handlers
            case "create_staff_leave": {
                const parsed = z.object({
                    staff_id: z.number(),
                    leave_category_id: z.number(),
                    start_date: z.string(),
                    end_date: z.string(),
                    reason: z.string(),
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;

                const [result] = await pool.execute(
                    `INSERT INTO staff_leave (staff_id, leave_category_id, leave_from, leave_to, reason, branch_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
                    [parsed.staff_id, parsed.leave_category_id, parsed.start_date, parsed.end_date, parsed.reason, branch_id]
                );
                return { content: [{ type: "text", text: `Staff leave application created. ID: ${(result as any).insertId}` }] };
            }

            case "list_staff_leaves": {
                const parsed = z.object({
                    staff_id: z.number().optional(),
                    status: z.enum(["pending", "approved", "rejected"]).optional(),
                    start_date: z.string().optional(),
                    end_date: z.string().optional(),
                    branch_id: z.number().optional(),
                    limit: z.number().optional()
                }).parse(args);

                let query = `SELECT sl.*, lc.name as leave_type, s.name as staff_name
                 FROM staff_leave sl
                 LEFT JOIN leave_category lc ON sl.leave_category_id = lc.id
                 LEFT JOIN staff s ON sl.staff_id = s.id
                 WHERE 1=1`;
                const params: any[] = [];

                if (parsed.staff_id) {
                    query += " AND sl.staff_id = ?";
                    params.push(parsed.staff_id);
                }
                if (parsed.status) {
                    query += " AND sl.status = ?";
                    params.push(parsed.status);
                }
                if (parsed.start_date) {
                    query += " AND sl.leave_from >= ?";
                    params.push(parsed.start_date);
                }
                if (parsed.end_date) {
                    query += " AND sl.leave_to <= ?";
                    params.push(parsed.end_date);
                }
                if (parsed.branch_id) {
                    query += " AND sl.branch_id = ?";
                    params.push(parsed.branch_id);
                }

                query += " ORDER BY sl.application_date DESC";

                if (parsed.limit) {
                    query += " LIMIT ?";
                    params.push(parsed.limit);
                } else {
                    query += " LIMIT 50";
                }

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "approve_staff_leave": {
                const parsed = z.object({
                    leave_id: z.number(),
                    status: z.enum(["approved", "rejected"]),
                    remarks: z.string().optional()
                }).parse(args);

                await pool.execute(
                    "UPDATE staff_leave SET status = ?, approved_by = ?, approved_date = NOW(), remarks = ? WHERE id = ?",
                    [parsed.status, 1, parsed.remarks || '', parsed.leave_id]
                );
                return { content: [{ type: "text", text: `Leave application ${parsed.status}` }] };
            }

            case "get_staff_leave_balance": {
                const parsed = z.object({
                    staff_id: z.number(),
                    leave_category_id: z.number().optional()
                }).parse(args);

                let query = `SELECT lc.id, lc.name, lc.days as total_days,
                 COALESCE((SELECT SUM(DATEDIFF(leave_to, leave_from) + 1) 
                           FROM staff_leave sl 
                           WHERE sl.leave_category_id = lc.id 
                           AND sl.staff_id = ? 
                           AND sl.status = 'approved'
                           AND YEAR(sl.leave_from) = YEAR(NOW())), 0) as days_used
                 FROM leave_category lc
                 WHERE 1=1`;
                const params: any[] = [parsed.staff_id];

                if (parsed.leave_category_id) {
                    query += " AND lc.id = ?";
                    params.push(parsed.leave_category_id);
                }

                const [rows] = await pool.execute(query, params) as any;
                const balance = rows.map((r: any) => ({
                    ...r,
                    available: r.total_days - r.days_used
                }));
                return { content: [{ type: "text", text: JSON.stringify(balance, null, 2) }] };
            }

            // Student Leave Management Handlers
            case "create_student_leave": {
                const parsed = z.object({
                    student_id: z.number(),
                    start_date: z.string(),
                    end_date: z.string(),
                    reason: z.string(),
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;

                const [result] = await pool.execute(
                    `INSERT INTO student_leave (student_id, leave_from, leave_to, reason, branch_id) 
         VALUES (?, ?, ?, ?, ?)`,
                    [parsed.student_id, parsed.start_date, parsed.end_date, parsed.reason, branch_id]
                );
                return { content: [{ type: "text", text: `Student leave application created. ID: ${(result as any).insertId}` }] };
            }

            case "list_student_leaves": {
                const parsed = z.object({
                    student_id: z.number().optional(),
                    class_id: z.number().optional(),
                    status: z.enum(["pending", "approved", "rejected"]).optional(),
                    start_date: z.string().optional(),
                    end_date: z.string().optional(),
                    branch_id: z.number().optional(),
                    limit: z.number().optional()
                }).parse(args);

                let query = `SELECT sl.*, s.name as student_name, s.register_no, c.classes as class_name
                 FROM student_leave sl
                 LEFT JOIN student s ON sl.student_id = s.id
                 LEFT JOIN classes c ON s.class = c.id
                 WHERE 1=1`;
                const params: any[] = [];

                if (parsed.student_id) {
                    query += " AND sl.student_id = ?";
                    params.push(parsed.student_id);
                }
                if (parsed.class_id) {
                    query += " AND s.class = ?";
                    params.push(parsed.class_id);
                }
                if (parsed.status) {
                    query += " AND sl.status = ?";
                    params.push(parsed.status);
                }
                if (parsed.start_date) {
                    query += " AND sl.leave_from >= ?";
                    params.push(parsed.start_date);
                }
                if (parsed.end_date) {
                    query += " AND sl.leave_to <= ?";
                    params.push(parsed.end_date);
                }
                if (parsed.branch_id) {
                    query += " AND sl.branch_id = ?";
                    params.push(parsed.branch_id);
                }

                query += " ORDER BY sl.application_date DESC";

                if (parsed.limit) {
                    query += " LIMIT ?";
                    params.push(parsed.limit);
                } else {
                    query += " LIMIT 50";
                }

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "approve_student_leave": {
                const parsed = z.object({
                    leave_id: z.number(),
                    status: z.enum(["approved", "rejected"]),
                    remarks: z.string().optional()
                }).parse(args);

                await pool.execute(
                    "UPDATE student_leave SET status = ?, approved_by = ?, approved_date = NOW(), remarks = ? WHERE id = ?",
                    [parsed.status, 1, parsed.remarks || '', parsed.leave_id]
                );
                return { content: [{ type: "text", text: `Student leave application ${parsed.status}` }] };
            }

            // Leave Category Handlers
            case "list_leave_categories": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);

                let query = "SELECT id, name, days as total_days, role_id, branch_id FROM leave_category WHERE 1=1";
                const params: any[] = [];

                if (parsed.branch_id) {
                    query += " AND branch_id = ?";
                    params.push(parsed.branch_id);
                }

                query += " ORDER BY name";

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_leave_category": {
                const parsed = z.object({
                    name: z.string(),
                    total_days: z.number(),
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;

                const [result] = await pool.execute(
                    "INSERT INTO leave_category (name, days, branch_id) VALUES (?, ?, ?)",
                    [parsed.name, parsed.total_days, branch_id]
                );
                return { content: [{ type: "text", text: `Leave category created. ID: ${(result as any).insertId}` }] };
            }

            // Salary Management Handlers
            case "list_salary_templates": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT id, name, basic_salary, total_salary FROM salary_template WHERE 1=1";
                const params: any[] = [];
                if (parsed.branch_id) {
                    query += " AND branch_id = ?";
                    params.push(parsed.branch_id);
                }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "assign_staff_salary": {
                const parsed = z.object({
                    staff_id: z.number(),
                    salary_template_id: z.number()
                }).parse(args);
                await pool.execute(
                    "UPDATE staff SET salary_template_id = ? WHERE id = ?",
                    [parsed.salary_template_id, parsed.staff_id]
                );
                return { content: [{ type: "text", text: `Salary template ${parsed.salary_template_id} assigned to staff ID ${parsed.staff_id}` }] };
            }

            // --- Complaint Implementation ---
            case "create_complaint": {
                const parsed = z.object({
                    complainant_name: z.string(),
                    number: z.string().optional(),
                    type_id: z.number().optional(),
                    date: z.string(),
                    assigned_id: z.number().optional(),
                    note: z.string().optional(),
                }).parse(args);

                const [result] = await pool.execute(
                    `INSERT INTO complaint (name, number, type_id, date, assigned_id, note, branch_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
                    [parsed.complainant_name, parsed.number || null, parsed.type_id || null, parsed.date, parsed.assigned_id || null, parsed.note || null]
                );
                return { content: [{ type: "text", text: `Complaint created. ID: ${(result as any).insertId}` }] };
            }

            case "list_complaints": {
                const parsed = z.object({ limit: z.number().default(50), offset: z.number().default(0) }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM complaint ORDER BY date DESC LIMIT ? OFFSET ?", [parsed.limit, parsed.offset]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "update_complaint": {
                const parsed = z.object({ id: z.number(), action: z.string().optional(), date_of_solution: z.string().optional(), note: z.string().optional() }).parse(args);
                const updates = []; const values = [];
                if (parsed.action) { updates.push("action = ?"); values.push(parsed.action); }
                if (parsed.date_of_solution) { updates.push("date_of_solution = ?"); values.push(parsed.date_of_solution); }
                if (parsed.note) { updates.push("note = ?"); values.push(parsed.note); }
                if (updates.length > 0) {
                    values.push(parsed.id);
                    await pool.execute(`UPDATE complaint SET ${updates.join(", ")} WHERE id = ?`, values);
                    return { content: [{ type: "text", text: `Complaint ${parsed.id} updated.` }] };
                }
                return { content: [{ type: "text", text: "No updates." }] };
            }

            case "delete_complaint": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM complaint WHERE id = ?", [id]);
                return { content: [{ type: "text", text: `Complaint ${id} deleted.` }] };
            }

            // --- Postal Record Implementation ---
            case "create_postal_record": {
                const parsed = z.object({
                    sender_title: z.string(),
                    receiver_title: z.string(),
                    reference_no: z.string().optional(),
                    address: z.string().optional(),
                    date: z.string(),
                    type: z.string(),
                    confidential: z.boolean().optional(),
                    note: z.string().optional(),
                }).parse(args);

                const [result] = await pool.execute(
                    `INSERT INTO postal_record (sender_title, receiver_title, reference_no, address, date, type, confidential, note, branch_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
                    [parsed.sender_title, parsed.receiver_title, parsed.reference_no || null, parsed.address || null, parsed.date, parsed.type, parsed.confidential ? 1 : 0, parsed.note || null]
                );
                return { content: [{ type: "text", text: `Postal record created. ID: ${(result as any).insertId}` }] };
            }

            case "list_postal_records": {
                const parsed = z.object({
                    limit: z.number().default(50),
                    offset: z.number().default(0),
                    type: z.string().optional()
                }).parse(args);

                let query = "SELECT * FROM postal_record";
                const params = [];
                if (parsed.type) {
                    query += " WHERE type = ?";
                    params.push(parsed.type);
                }
                query += " ORDER BY date DESC LIMIT ? OFFSET ?";
                params.push(parsed.limit, parsed.offset);

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "update_postal_record": {
                const parsed = z.object({ id: z.number(), address: z.string().optional(), note: z.string().optional() }).parse(args);
                const updates = []; const values = [];
                if (parsed.address) { updates.push("address = ?"); values.push(parsed.address); }
                if (parsed.note) { updates.push("note = ?"); values.push(parsed.note); }
                if (updates.length > 0) {
                    values.push(parsed.id);
                    await pool.execute(`UPDATE postal_record SET ${updates.join(", ")} WHERE id = ?`, values);
                    return { content: [{ type: "text", text: `Postal record ${parsed.id} updated.` }] };
                }
                return { content: [{ type: "text", text: "No updates." }] };
            }

            case "delete_postal_record": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM postal_record WHERE id = ?", [id]);
                return { content: [{ type: "text", text: `Postal record ${id} deleted.` }] };
            }

            // --- Fees Module Implementation ---
            case "create_fee_type": {
                const parsed = z.object({
                    name: z.string(),
                    description: z.string().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                const fee_code = parsed.name.toLowerCase().replace(/ /g, '-');
                const [result] = await pool.execute(
                    "INSERT INTO fees_type (name, fee_code, description, branch_id, system, created_at) VALUES (?, ?, ?, ?, 0, NOW())",
                    [parsed.name, fee_code, parsed.description || null, parsed.branch_id || 1]
                );
                return { content: [{ type: "text", text: `Fee type created. ID: ${(result as any).insertId}` }] };
            }

            case "list_fee_types": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM fees_type";
                const params = [];
                if (parsed.branch_id) {
                    query += " WHERE branch_id = ?";
                    params.push(parsed.branch_id);
                }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "update_fee_type": {
                const parsed = z.object({ id: z.number(), name: z.string().optional(), description: z.string().optional() }).parse(args);
                const updates = []; const values = [];
                if (parsed.name) {
                    updates.push("name = ?"); values.push(parsed.name);
                    updates.push("fee_code = ?"); values.push(parsed.name.toLowerCase().replace(/ /g, '-'));
                }
                if (parsed.description) { updates.push("description = ?"); values.push(parsed.description); }
                if (updates.length > 0) {
                    values.push(parsed.id);
                    await pool.execute(`UPDATE fees_type SET ${updates.join(", ")} WHERE id = ?`, values);
                    return { content: [{ type: "text", text: `Fee type ${parsed.id} updated.` }] };
                }
                return { content: [{ type: "text", text: "No updates." }] };
            }

            case "delete_fee_type": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM fees_type WHERE id = ?", [id]);
                return { content: [{ type: "text", text: `Fee type ${id} deleted.` }] };
            }

            case "create_fee_group": {
                const parsed = z.object({
                    name: z.string(),
                    description: z.string().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                const [result] = await pool.execute(
                    "INSERT INTO fee_groups (name, description, branch_id, session_id, system, created_at) VALUES (?, ?, ?, 1, 0, NOW())",
                    [parsed.name, parsed.description || null, parsed.branch_id || 1]
                );
                return { content: [{ type: "text", text: `Fee group created. ID: ${(result as any).insertId}` }] };
            }

            case "list_fee_groups": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM fee_groups";
                const params = [];
                if (parsed.branch_id) {
                    query += " WHERE branch_id = ?";
                    params.push(parsed.branch_id);
                }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "add_fee_group_details": {
                const parsed = z.object({
                    fee_groups_id: z.number(),
                    fee_type_id: z.number(),
                    amount: z.number(),
                    due_date: z.string()
                }).parse(args);
                await pool.execute(
                    "INSERT INTO fee_groups_details (fee_groups_id, fee_type_id, amount, due_date) VALUES (?, ?, ?, ?)",
                    [parsed.fee_groups_id, parsed.fee_type_id, parsed.amount, parsed.due_date]
                );
                return { content: [{ type: "text", text: "Fee group details added." }] };
            }

            case "allocate_fees": {
                const parsed = z.object({
                    student_id: z.number(),
                    group_id: z.number(),
                    branch_id: z.number().optional(),
                    prev_due: z.number().optional()
                }).parse(args);
                const [result] = await pool.execute(
                    "INSERT INTO fee_allocation (student_id, group_id, branch_id, session_id, prev_due) VALUES (?, ?, ?, 1, ?)",
                    [parsed.student_id, parsed.group_id, parsed.branch_id || 1, parsed.prev_due || 0]
                );
                return { content: [{ type: "text", text: `Fees allocated. Allocation ID: ${(result as any).insertId}` }] };
            }

            case "collect_fees": {
                const parsed = z.object({
                    allocation_id: z.number(),
                    type_id: z.number(),
                    amount: z.number(),
                    discount: z.number().optional(),
                    fine: z.number().optional(),
                    date: z.string(),
                    method: z.string().optional(),
                    pay_via: z.number().optional(),
                    remarks: z.string().optional()
                }).parse(args);
                const [result] = await pool.execute(
                    `INSERT INTO fee_payment_history 
                    (allocation_id, type_id, collect_by, remarks, amount, discount, fine, date, pay_via) 
                    VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, ?)`,
                    [parsed.allocation_id, parsed.type_id, parsed.remarks || null, parsed.amount, parsed.discount || 0, parsed.fine || 0, parsed.date, parsed.pay_via || 1]
                );
                return { content: [{ type: "text", text: `Payment recorded. Payment ID: ${(result as any).insertId}` }] };
            }

            case "get_student_fee_status": {
                const { student_id } = z.object({ student_id: z.number() }).parse(args);
                // Basic status: Total allocated, Total paid, Balance
                const query = `
                    SELECT 
                        SUM(gd.amount + fa.prev_due) as total_allocated,
                        (SELECT SUM(amount + discount) FROM fee_payment_history h JOIN fee_allocation a ON h.allocation_id = a.id WHERE a.student_id = fa.student_id AND a.session_id = 4) as total_paid_with_discount,
                        (SELECT SUM(amount) FROM fee_payment_history h JOIN fee_allocation a ON h.allocation_id = a.id WHERE a.student_id = fa.student_id AND a.session_id = 4) as total_paid_only
                    FROM fee_allocation fa
                    LEFT JOIN fee_groups_details gd ON fa.group_id = gd.fee_groups_id
                    WHERE fa.student_id = ? AND fa.session_id = 4
                `;
                const [rows] = await pool.execute(query, [student_id]);
                const status = (rows as any)[0];
                const balance = (status.total_allocated || 0) - (status.total_paid_with_discount || 0);
                return { content: [{ type: "text", text: JSON.stringify({ ...status, balance }, null, 2) }] };
            }

            case "get_fee_payment_history": {
                const { allocation_id } = z.object({ allocation_id: z.number() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM fee_payment_history WHERE allocation_id = ? ORDER BY date DESC", [allocation_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "update_fee_payment": {
                const parsed = z.object({
                    id: z.number(),
                    amount: z.number().optional(),
                    discount: z.number().optional(),
                    fine: z.number().optional(),
                    date: z.string().optional(),
                    remarks: z.string().optional()
                }).parse(args);

                const updates: string[] = [];
                const values: any[] = [];
                if (parsed.amount !== undefined) { updates.push("amount = ?"); values.push(parsed.amount); }
                if (parsed.discount !== undefined) { updates.push("discount = ?"); values.push(parsed.discount); }
                if (parsed.fine !== undefined) { updates.push("fine = ?"); values.push(parsed.fine); }
                if (parsed.date) { updates.push("date = ?"); values.push(parsed.date); }
                if (parsed.remarks) { updates.push("remarks = ?"); values.push(parsed.remarks); }

                if (updates.length > 0) {
                    values.push(parsed.id);
                    await pool.execute(`UPDATE fee_payment_history SET ${updates.join(", ")} WHERE id = ?`, values);
                    return { content: [{ type: "text", text: `Payment record ${parsed.id} updated.` }] };
                }
                return { content: [{ type: "text", text: "No updates provided." }] };
            }

            case "bulk_collect_fees": {
                const parsed = z.object({
                    payments: z.array(z.object({
                        allocation_id: z.number(),
                        type_id: z.number(),
                        amount: z.number(),
                        date: z.string()
                    })),
                    branch_id: z.number().optional()
                }).parse(args);

                const results = [];
                for (const p of parsed.payments) {
                    const [res] = await pool.execute(
                        "INSERT INTO fee_payment_history (allocation_id, type_id, collect_by, amount, date) VALUES (?, ?, 'admin', ?, ?)",
                        [p.allocation_id, p.type_id, p.amount, p.date]
                    );
                    results.push({ allocation_id: p.allocation_id, payment_id: (res as any).insertId });
                }
                return { content: [{ type: "text", text: `Bulk payments recorded. Total: ${results.length} payments.` }] };
            }

            case "update_fee_allocation": {
                const parsed = z.object({
                    id: z.number(),
                    prev_due: z.number()
                }).parse(args);
                await pool.execute("UPDATE fee_allocation SET prev_due = ? WHERE id = ?", [parsed.prev_due, parsed.id]);
                return { content: [{ type: "text", text: `Fee allocation ${parsed.id} updated.` }] };
            }

            case "list_payment_methods": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                const branch_id = parsed.branch_id || 1;
                const [rows] = await pool.execute("SELECT * FROM payment_types WHERE branch_id = ?", [branch_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "set_fee_status": {
                const parsed = z.object({
                    student_id: z.number(),
                    status: z.enum(["Paid", "Unpaid"]),
                    date: z.string().optional()
                }).parse(args);

                if (parsed.status === "Paid") {
                    // 1. Get total allocated for student
                    const [allocs] = await pool.execute(`
                        SELECT fa.id as allocation_id, gd.fee_type_id, (gd.amount + fa.prev_due) as total_due
                        FROM fee_allocation fa
                        JOIN fee_groups_details gd ON fa.group_id = gd.fee_groups_id
                        WHERE fa.student_id = ? AND fa.session_id = 4
                    `, [parsed.student_id]);

                    const paymentDate = parsed.date || new Date().toISOString().split('T')[0];
                    let count = 0;

                    for (const row of (allocs as any[])) {
                        // 2. Check current paid for this allocation/type
                        const [history] = await pool.execute(`
                            SELECT SUM(amount + discount) as paid 
                            FROM fee_payment_history 
                            WHERE allocation_id = ? AND type_id = ?
                        `, [row.allocation_id, row.fee_type_id]);

                        const paid = (history as any)[0].paid || 0;
                        const remaining = row.total_due - paid;

                        if (remaining > 0) {
                            await pool.execute(
                                "INSERT INTO fee_payment_history (allocation_id, type_id, collect_by, amount, date) VALUES (?, ?, 'admin', ?, ?)",
                                [row.allocation_id, row.fee_type_id, remaining, paymentDate]
                            );
                            count++;
                        }
                    }
                    return { content: [{ type: "text", text: `Status set to Paid. Recorded ${count} payment entries to clear balance.` }] };
                } else {
                    // status === "Unpaid" -> Simple approach: delete all payments for student in current session
                    await pool.execute(`
                        DELETE h FROM fee_payment_history h
                        JOIN fee_allocation fa ON h.allocation_id = fa.id
                        WHERE fa.student_id = ? AND fa.session_id = 4
                    `, [parsed.student_id]);
                    return { content: [{ type: "text", text: "Status set to Unpaid. All payment records for current session have been removed." }] };
                }
            }

            // --- Examination Module Implementation ---
            case "create_exam": {
                const parsed = z.object({
                    exam_id: z.number().optional(),
                    name: z.string(),
                    term_id: z.number().optional(),
                    type_id: z.number().optional(),
                    mark_distribution: z.array(z.number()).optional(),
                    remark: z.string().optional(),
                    branch_id: z.number().optional()
                }).parse(args);

                if (parsed.exam_id) {
                    const updates = []; const values = [];
                    if (parsed.name) { updates.push("name = ?"); values.push(parsed.name); }
                    if (parsed.term_id) { updates.push("term_id = ?"); values.push(parsed.term_id); }
                    if (parsed.type_id) { updates.push("type_id = ?"); values.push(parsed.type_id); }
                    if (parsed.mark_distribution) { updates.push("mark_distribution = ?"); values.push(JSON.stringify(parsed.mark_distribution)); }
                    if (parsed.remark) { updates.push("remark = ?"); values.push(parsed.remark); }
                    if (updates.length > 0) {
                        values.push(parsed.exam_id);
                        await pool.execute(`UPDATE exam SET ${updates.join(", ")} WHERE id = ?`, values);
                        return { content: [{ type: "text", text: `Exam ${parsed.exam_id} updated.` }] };
                    }
                } else {
                    const [result] = await pool.execute(
                        "INSERT INTO exam (name, term_id, type_id, mark_distribution, remark, branch_id, session_id) VALUES (?, ?, ?, ?, ?, ?, 4)",
                        [parsed.name, parsed.term_id || null, parsed.type_id || null, JSON.stringify(parsed.mark_distribution || []), parsed.remark || null, parsed.branch_id || 1]
                    );
                    return { content: [{ type: "text", text: `Exam created. ID: ${(result as any).insertId}` }] };
                }
                return { content: [{ type: "text", text: "Invalid request." }] };
            }

            case "list_exams": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM exam WHERE session_id = 4";
                const params = [];
                if (parsed.branch_id) {
                    query += " AND branch_id = ?";
                    params.push(parsed.branch_id);
                }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "delete_exam": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM exam WHERE id = ?", [id]);
                return { content: [{ type: "text", text: `Exam ${id} deleted.` }] };
            }

            case "create_exam_term": {
                const parsed = z.object({
                    term_id: z.number().optional(),
                    term_name: z.string(),
                    branch_id: z.number().optional()
                }).parse(args);
                if (parsed.term_id) {
                    await pool.execute("UPDATE exam_term SET name = ? WHERE id = ?", [parsed.term_name, parsed.term_id]);
                    return { content: [{ type: "text", text: `Term ${parsed.term_id} updated.` }] };
                } else {
                    const [result] = await pool.execute(
                        "INSERT INTO exam_term (name, branch_id, session_id) VALUES (?, ?, 4)",
                        [parsed.term_name, parsed.branch_id || 1]
                    );
                    return { content: [{ type: "text", text: `Term created. ID: ${(result as any).insertId}` }] };
                }
            }

            case "list_exam_terms": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM exam_term WHERE session_id = 4";
                const params = [];
                if (parsed.branch_id) {
                    query += " AND branch_id = ?";
                    params.push(parsed.branch_id);
                }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_exam_hall": {
                const parsed = z.object({
                    hall_id: z.number().optional(),
                    hall_no: z.string(),
                    no_of_seats: z.number(),
                    branch_id: z.number().optional()
                }).parse(args);
                if (parsed.hall_id) {
                    await pool.execute("UPDATE exam_hall SET hall_no = ?, seats = ? WHERE id = ?", [parsed.hall_no, parsed.no_of_seats, parsed.hall_id]);
                    return { content: [{ type: "text", text: `Hall ${parsed.hall_id} updated.` }] };
                } else {
                    const [result] = await pool.execute(
                        "INSERT INTO exam_hall (hall_no, seats, branch_id) VALUES (?, ?, ?)",
                        [parsed.hall_no, parsed.no_of_seats, parsed.branch_id || 1]
                    );
                    return { content: [{ type: "text", text: `Hall created. ID: ${(result as any).insertId}` }] };
                }
            }

            case "list_exam_halls": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM exam_hall";
                const params = [];
                if (parsed.branch_id) {
                    query += " WHERE branch_id = ?";
                    params.push(parsed.branch_id);
                }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_grade": {
                const parsed = z.object({
                    grade_id: z.number().optional(),
                    name: z.string(),
                    grade_point: z.number(),
                    lower_mark: z.number(),
                    upper_mark: z.number(),
                    remark: z.string().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                if (parsed.grade_id) {
                    await pool.execute(
                        "UPDATE grade SET name = ?, grade_point = ?, lower_mark = ?, upper_mark = ?, remark = ? WHERE id = ?",
                        [parsed.name, parsed.grade_point, parsed.lower_mark, parsed.upper_mark, parsed.remark || null, parsed.grade_id]
                    );
                    return { content: [{ type: "text", text: `Grade ${parsed.grade_id} updated.` }] };
                } else {
                    const [result] = await pool.execute(
                        "INSERT INTO grade (name, grade_point, lower_mark, upper_mark, remark, branch_id) VALUES (?, ?, ?, ?, ?, ?)",
                        [parsed.name, parsed.grade_point, parsed.lower_mark, parsed.upper_mark, parsed.remark || null, parsed.branch_id || 1]
                    );
                    return { content: [{ type: "text", text: `Grade created. ID: ${(result as any).insertId}` }] };
                }
            }

            case "list_grades": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM grade";
                const params = [];
                if (parsed.branch_id) {
                    query += " WHERE branch_id = ?";
                    params.push(parsed.branch_id);
                }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "record_marks": {
                const parsed = z.object({
                    student_id: z.number(),
                    exam_id: z.number(),
                    subject_id: z.number(),
                    class_id: z.number(),
                    section_id: z.number(),
                    mark: z.number(),
                    absent: z.boolean().optional()
                }).parse(args);
                // Check if mark already exists
                const [existing] = await pool.execute(
                    "SELECT id FROM mark WHERE student_id = ? AND exam_id = ? AND subject_id = ? AND class_id = ? AND section_id = ? AND session_id = 4",
                    [parsed.student_id, parsed.exam_id, parsed.subject_id, parsed.class_id, parsed.section_id]
                );
                if ((existing as any[]).length > 0) {
                    await pool.execute(
                        "UPDATE mark SET mark = ?, absent = ? WHERE id = ?",
                        [parsed.mark, parsed.absent ? 1 : 0, (existing as any[])[0].id]
                    );
                    return { content: [{ type: "text", text: "Marks updated." }] };
                } else {
                    await pool.execute(
                        "INSERT INTO mark (student_id, exam_id, subject_id, class_id, section_id, session_id, mark, absent) VALUES (?, ?, ?, ?, ?, 4, ?, ?)",
                        [parsed.student_id, parsed.exam_id, parsed.subject_id, parsed.class_id, parsed.section_id, parsed.mark, parsed.absent ? 1 : 0]
                    );
                    return { content: [{ type: "text", text: "Marks recorded." }] };
                }
            }

            case "get_student_marks": {
                const parsed = z.object({ student_id: z.number(), exam_id: z.number() }).parse(args);
                const query = `
                    SELECT m.mark, m.absent, s.name as subject_name
                    FROM mark m
                    JOIN subject s ON m.subject_id = s.id
                    WHERE m.student_id = ? AND m.exam_id = ? AND m.session_id = 4
                `;
                const [rows] = await pool.execute(query, [parsed.student_id, parsed.exam_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "list_class_marks": {
                const parsed = z.object({ class_id: z.number(), section_id: z.number(), exam_id: z.number() }).parse(args);
                const query = `
                    SELECT 
                        s.id as student_id, s.first_name, s.last_name, s.register_no,
                        sub.name as subject_name,
                        m.mark as mark, m.absent
                    FROM mark m
                    JOIN student s ON m.student_id = s.id
                    JOIN subject sub ON m.subject_id = sub.id
                    WHERE m.class_id = ? AND m.section_id = ? AND m.exam_id = ? AND m.session_id = 4
                    ORDER BY s.id, sub.id
                `;
                const [rows] = await pool.execute(query, [parsed.class_id, parsed.section_id, parsed.exam_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "list_pending_fees": {
                const parsed = z.object({
                    branch_id: z.number().optional(),
                    class_id: z.number().optional(),
                }).parse(args);

                let query = `
                    SELECT 
                        s.id as student_id, s.first_name, s.last_name, s.register_no,
                        c.name as class_name, se.name as section_name,
                        COALESCE(SUM(gd.amount), 0) + COALESCE(MAX(fa.prev_due), 0) as total_allocated,
                        COALESCE((
                            SELECT SUM(h.amount + h.discount) 
                            FROM fee_payment_history h 
                            JOIN fee_allocation a ON h.allocation_id = a.id 
                            WHERE a.student_id = s.id AND a.session_id = 4
                        ), 0) as total_paid
                    FROM student s
                    JOIN enroll e ON s.id = e.student_id
                    JOIN class c ON e.class_id = c.id
                    JOIN section se ON e.section_id = se.id
                    LEFT JOIN fee_allocation fa ON s.id = fa.student_id AND e.session_id = fa.session_id
                    LEFT JOIN fee_groups_details gd ON fa.group_id = gd.fee_groups_id
                    WHERE e.session_id = 4
                `;

                const params: any[] = [];
                if (parsed.branch_id) {
                    query += " AND e.branch_id = ?";
                    params.push(parsed.branch_id);
                }
                if (parsed.class_id) {
                    query += " AND e.class_id = ?";
                    params.push(parsed.class_id);
                }

                query += " GROUP BY s.id HAVING (total_allocated - total_paid) > 0";

                const [rows] = await pool.execute(query, params);
                const results = (rows as any[]).map(r => ({
                    ...r,
                    balance: r.total_allocated - r.total_paid
                }));

                return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
            }

            case "list_at_risk_students": {
                const parsed = z.object({
                    class_id: z.number().optional(),
                    exam_id: z.number(),
                }).parse(args);

                let query = `
                    WITH FailCount AS (
                        SELECT student_id, COUNT(*) as failed_subjects
                        FROM mark
                        WHERE exam_id = ? AND session_id = 4 AND (
                            CAST(JSON_EXTRACT(mark, '$.\"12\"') AS DECIMAL) < 33 OR absent = 1
                        )
                        GROUP BY student_id
                    ),
                    FeeBalance AS (
                        SELECT 
                            fa.student_id,
                            (COALESCE(SUM(gd.amount), 0) + COALESCE(MAX(fa.prev_due), 0)) - 
                            COALESCE((
                                SELECT SUM(h.amount + h.discount) 
                                FROM fee_payment_history h 
                                JOIN fee_allocation a ON h.allocation_id = a.id 
                                WHERE a.student_id = fa.student_id AND a.session_id = 4
                            ), 0) as balance
                        FROM fee_allocation fa
                        LEFT JOIN fee_groups_details gd ON fa.group_id = gd.fee_groups_id
                        WHERE fa.session_id = 4
                        GROUP BY fa.student_id
                    )
                    SELECT 
                        s.id as student_id, s.first_name, s.last_name, s.register_no,
                        c.name as class_name, se.name as section_name,
                        COALESCE(fc.failed_subjects, 0) as failed_subjects,
                        COALESCE(fb.balance, 0) as pending_balance
                    FROM student s
                    JOIN enroll e ON s.id = e.student_id
                    JOIN class c ON e.class_id = c.id
                    JOIN section se ON e.section_id = se.id
                    LEFT JOIN FailCount fc ON s.id = fc.student_id
                    LEFT JOIN FeeBalance fb ON s.id = fb.student_id
                    WHERE e.session_id = 4
                `;

                const params: any[] = [parsed.exam_id];
                if (parsed.class_id) {
                    query += " AND e.class_id = ?";
                    params.push(parsed.class_id);
                }

                query += " HAVING (failed_subjects > 0 AND pending_balance > 0) OR pending_balance > 500 OR failed_subjects > 2";
                query += " ORDER BY pending_balance DESC, failed_subjects DESC";

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "get_attendance_report": {
                const parsed = z.object({
                    class_id: z.number(),
                    section_id: z.number().optional(),
                    date: z.string().optional(),
                }).parse(args);

                const reportDate = parsed.date || new Date().toISOString().split('T')[0];

                let query = `
                    SELECT 
                        s.id as student_id, s.first_name, s.last_name, s.register_no,
                        sa.status, sa.remark, sa.date
                    FROM student_attendance sa
                    JOIN enroll e ON sa.enroll_id = e.id
                    JOIN student s ON e.student_id = s.id
                    WHERE e.class_id = ? AND sa.date = ? AND e.session_id = 4
                `;

                const params: any[] = [parsed.class_id, reportDate];
                if (parsed.section_id) {
                    query += " AND e.section_id = ?";
                    params.push(parsed.section_id);
                }

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "list_top_students": {
                const parsed = z.object({
                    class_id: z.number().optional(),
                    exam_id: z.number(),
                }).parse(args);

                let query = `
                    WITH TotalMarks AS (
                        SELECT student_id, SUM(CAST(JSON_EXTRACT(mark, '$.\"12\"') AS DECIMAL)) as total_marks
                        FROM mark
                        WHERE exam_id = ? AND session_id = 4
                        GROUP BY student_id
                    ),
                    FeeBalance AS (
                        SELECT 
                            fa.student_id,
                            (COALESCE(SUM(gd.amount), 0) + COALESCE(MAX(fa.prev_due), 0)) - 
                            COALESCE((
                                SELECT SUM(h.amount + h.discount) 
                                FROM fee_payment_history h 
                                JOIN fee_allocation a ON h.allocation_id = a.id 
                                WHERE a.student_id = fa.student_id AND a.session_id = 4
                            ), 0) as balance
                        FROM fee_allocation fa
                        LEFT JOIN fee_groups_details gd ON fa.group_id = gd.fee_groups_id
                        WHERE fa.session_id = 4
                        GROUP BY fa.student_id
                    ),
                    AttendanceRate AS (
                        SELECT 
                            e.student_id,
                            COUNT(*) as total_days,
                            SUM(CASE WHEN sa.status = 'P' THEN 1 ELSE 0 END) as present_days
                        FROM student_attendance sa
                        JOIN enroll e ON sa.enroll_id = e.id
                        WHERE e.session_id = 4
                        GROUP BY e.student_id
                    )
                    SELECT 
                        s.id as student_id, s.first_name, s.last_name, s.register_no,
                        c.name as class_name, se.name as section_name,
                        COALESCE(tm.total_marks, 0) as total_marks,
                        COALESCE(fb.balance, 0) as balance,
                        CASE WHEN ar.total_days > 0 THEN (ar.present_days * 100.0 / ar.total_days) ELSE 0 END as attendance_percentage
                    FROM student s
                    JOIN enroll e ON s.id = e.student_id
                    JOIN class c ON e.class_id = c.id
                    JOIN section se ON e.section_id = se.id
                    LEFT JOIN TotalMarks tm ON s.id = tm.student_id
                    LEFT JOIN FeeBalance fb ON s.id = fb.student_id
                    LEFT JOIN AttendanceRate ar ON s.id = ar.student_id
                    WHERE e.session_id = 4
                `;

                const params: any[] = [parsed.exam_id];
                if (parsed.class_id) {
                    query += " AND e.class_id = ?";
                    params.push(parsed.class_id);
                }

                // Criteria: Balance <= 0 (paid), Marks > 50, Attendance >= 70%
                query += " HAVING balance <= 0 AND total_marks > 50 AND attendance_percentage >= 70";
                query += " ORDER BY total_marks DESC, attendance_percentage DESC";

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "list_reception_configs": {
                const parsed = z.object({
                    type: z.enum(["call_purpose", "complaint_type", "enquiry_reference", "enquiry_response", "visitor_purpose"]),
                    branch_id: z.number().optional()
                }).parse(args);

                let query = `SELECT id, name FROM ${parsed.type}`;
                const params: any[] = [];
                if (parsed.branch_id) {
                    query += " WHERE branch_id = ?";
                    params.push(parsed.branch_id);
                }

                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_reception_config": {
                const parsed = z.object({
                    type: z.enum(["call_purpose", "complaint_type", "enquiry_reference", "enquiry_response", "visitor_purpose"]),
                    name: z.string(),
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;

                const [result] = await pool.execute(
                    `INSERT INTO ${parsed.type} (name, branch_id) VALUES (?, ?)`,
                    [parsed.name, branch_id]
                );
                return { content: [{ type: "text", text: `Configuration added to ${parsed.type}. ID: ${(result as any).insertId}` }] };
            }

            case "delete_reception_config": {
                const parsed = z.object({
                    type: z.enum(["call_purpose", "complaint_type", "enquiry_reference", "enquiry_response", "visitor_purpose"]),
                    id: z.number()
                }).parse(args);

                await pool.execute(`DELETE FROM ${parsed.type} WHERE id = ?`, [parsed.id]);
                return { content: [{ type: "text", text: `Configuration ${parsed.id} deleted from ${parsed.type}.` }] };
            }

            case "get_exam_timetable": {
                const parsed = z.object({ class_id: z.number(), section_id: z.number(), exam_id: z.number() }).parse(args);
                const query = "SELECT * FROM timetable_exam WHERE class_id = ? AND section_id = ? AND exam_id = ? AND session_id = 4";
                const [rows] = await pool.execute(query, [parsed.class_id, parsed.section_id, parsed.exam_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            // --- Timetable Module Implementation ---
            case "create_class_timetable": {
                const parsed = z.object({
                    class_id: z.number(),
                    section_id: z.number(),
                    subject_id: z.number().optional(),
                    teacher_id: z.number().optional(),
                    time_start: z.string(),
                    time_end: z.string(),
                    class_room: z.string().optional(),
                    day: z.string(),
                    branch_id: z.number().optional(),
                    is_break: z.boolean().optional()
                }).parse(args);
                const [result] = await pool.execute(
                    "INSERT INTO timetable_class (class_id, section_id, subject_id, teacher_id, time_start, time_end, class_room, day, branch_id, session_id, `break`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 4, ?)",
                    [parsed.class_id, parsed.section_id, parsed.subject_id || 0, parsed.teacher_id || 0, parsed.time_start, parsed.time_end, parsed.class_room || null, parsed.day, parsed.branch_id || 1, parsed.is_break ? 1 : 0]
                );
                return { content: [{ type: "text", text: `Timetable entry created. ID: ${(result as any).insertId}` }] };
            }

            case "list_class_timetable": {
                const parsed = z.object({ class_id: z.number(), section_id: z.number() }).parse(args);
                const query = `
                    SELECT tc.*, s.name as subject_name, st.name as teacher_name
                    FROM timetable_class tc
                    LEFT JOIN subject s ON tc.subject_id = s.id
                    LEFT JOIN staff st ON tc.teacher_id = st.id
                    WHERE tc.class_id = ? AND tc.section_id = ? AND tc.session_id = 4
                    ORDER BY FIELD(tc.day, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'), tc.time_start
                `;
                const [rows] = await pool.execute(query, [parsed.class_id, parsed.section_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "delete_class_timetable": {
                const { id } = z.object({ id: z.number() }).parse(args);
                await pool.execute("DELETE FROM timetable_class WHERE id = ?", [id]);
                return { content: [{ type: "text", text: `Timetable entry ${id} deleted.` }] };
            }

            case "get_teacher_schedule": {
                const { teacher_id } = z.object({ teacher_id: z.number() }).parse(args);
                const query = `
                    SELECT tc.*, c.name as class_name, se.name as section_name, s.name as subject_name
                    FROM timetable_class tc
                    JOIN class c ON tc.class_id = c.id
                    JOIN section se ON tc.section_id = se.id
                    JOIN subject s ON tc.subject_id = s.id
                    WHERE tc.teacher_id = ? AND tc.session_id = 4
                    ORDER BY FIELD(tc.day, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'), tc.time_start
                `;
                const [rows] = await pool.execute(query, [teacher_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_exam_timetable": {
                const parsed = z.object({
                    exam_id: z.number(),
                    class_id: z.number(),
                    section_id: z.number(),
                    subject_id: z.number(),
                    time_start: z.string(),
                    time_end: z.string(),
                    hall_id: z.number().optional(),
                    exam_date: z.string(),
                    mark_distribution: z.string().optional(),
                    branch_id: z.number().optional()
                }).parse(args);
                // Check if exists
                const [existing] = await pool.execute(
                    "SELECT id FROM timetable_exam WHERE exam_id = ? AND class_id = ? AND section_id = ? AND subject_id = ? AND session_id = 4",
                    [parsed.exam_id, parsed.class_id, parsed.section_id, parsed.subject_id]
                );
                if ((existing as any[]).length > 0) {
                    await pool.execute(
                        "UPDATE timetable_exam SET time_start = ?, time_end = ?, hall_id = ?, exam_date = ?, mark_distribution = ? WHERE id = ?",
                        [parsed.time_start, parsed.time_end, parsed.hall_id || 0, parsed.exam_date, parsed.mark_distribution || '[]', (existing as any[])[0].id]
                    );
                    return { content: [{ type: "text", text: "Exam timetable updated." }] };
                } else {
                    await pool.execute(
                        "INSERT INTO timetable_exam (exam_id, class_id, section_id, subject_id, time_start, time_end, hall_id, exam_date, mark_distribution, branch_id, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4)",
                        [parsed.exam_id, parsed.class_id, parsed.section_id, parsed.subject_id, parsed.time_start, parsed.time_end, parsed.hall_id || 0, parsed.exam_date, parsed.mark_distribution || '[]', parsed.branch_id || 1]
                    );
                    return { content: [{ type: "text", text: "Exam timetable created." }] };
                }
            }

            case "list_exam_timetable": {
                const parsed = z.object({ exam_id: z.number(), class_id: z.number(), section_id: z.number() }).parse(args);
                const query = `
                    SELECT t.*, s.name as subject_name, eh.hall_no
                    FROM timetable_exam t
                    LEFT JOIN subject s ON t.subject_id = s.id
                    LEFT JOIN exam_hall eh ON t.hall_id = eh.id
                    WHERE t.exam_id = ? AND t.class_id = ? AND t.section_id = ? AND t.session_id = 4
                    ORDER BY t.exam_date, t.time_start
                `;
                const [rows] = await pool.execute(query, [parsed.exam_id, parsed.class_id, parsed.section_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            // --- Student Module Implementation ---
            case "list_students": {
                const parsed = z.object({
                    branch_id: z.number().optional(),
                    class_id: z.number().optional(),
                    section_id: z.number().optional()
                }).parse(args);
                let query = `
                    SELECT e.*, s.first_name, s.last_name, s.register_no, s.email, c.name as class_name, se.name as section_name
                    FROM enroll e
                    JOIN student s ON e.student_id = s.id
                    JOIN class c ON e.class_id = c.id
                    JOIN section se ON e.section_id = se.id
                    WHERE e.session_id = 4
                `;
                const params: any[] = [];
                if (parsed.branch_id) { query += " AND e.branch_id = ?"; params.push(parsed.branch_id); }
                if (parsed.class_id) { query += " AND e.class_id = ?"; params.push(parsed.class_id); }
                if (parsed.section_id) { query += " AND e.section_id = ?"; params.push(parsed.section_id); }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "get_student": {
                const { id } = z.object({ id: z.number() }).parse(args);
                const query = `
                    SELECT s.*, e.class_id, e.section_id, e.roll, c.name as class_name, se.name as section_name
                    FROM student s
                    LEFT JOIN enroll e ON s.id = e.student_id AND e.session_id = 4
                    LEFT JOIN class c ON e.class_id = c.id
                    LEFT JOIN section se ON e.section_id = se.id
                    WHERE s.id = ?
                `;
                const [rows] = await pool.execute(query, [id]);
                return { content: [{ type: "text", text: JSON.stringify((rows as any[])[0] || {}, null, 2) }] };
            }

            case "search_students": {
                const { search } = z.object({ search: z.string() }).parse(args);
                const query = `
                    SELECT s.id, s.first_name, s.last_name, s.register_no, s.email
                    FROM student s
                    WHERE s.first_name LIKE ? OR s.last_name LIKE ? OR s.register_no LIKE ? OR s.email LIKE ?
                `;
                const term = `%${search}%`;
                const [rows] = await pool.execute(query, [term, term, term, term]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_student": {
                const parsed = z.object({
                    first_name: z.string(),
                    last_name: z.string(),
                    register_no: z.string(),
                    admission_date: z.string(),
                    gender: z.string().optional(),
                    birthday: z.string().optional(),
                    mobileno: z.string().optional(),
                    email: z.string().optional(),
                    parent_id: z.number().optional(),
                    branch_id: z.number().optional(),
                    class_id: z.number(),
                    section_id: z.number(),
                    // Additional fields
                    category_id: z.number().optional(),
                    religion: z.string().optional(),
                    caste: z.string().optional(),
                    blood_group: z.string().optional(),
                    current_address: z.string().optional(),
                    permanent_address: z.string().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;

                // 1. Insert into student table
                const [result] = await pool.execute(
                    `INSERT INTO student 
                    (first_name, last_name, register_no, admission_date, gender, birthday, mobileno, email, parent_id, branch_id, class, section,
                     category_id, religion, caste, blood_group, current_address, permanent_address) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        parsed.first_name, parsed.last_name, parsed.register_no, parsed.admission_date,
                        parsed.gender || 'male', parsed.birthday || null, parsed.mobileno || '', parsed.email || '',
                        parsed.parent_id || null, branch_id, parsed.class_id, parsed.section_id,
                        parsed.category_id || null, parsed.religion || '', parsed.caste || '', parsed.blood_group || '',
                        parsed.current_address || '', parsed.permanent_address || ''
                    ]
                );

                const studentId = (result as any).insertId;

                // 2. Add to enroll table for current session (assuming session_id=4 based on previous code)
                await pool.execute(
                    "INSERT INTO enroll (student_id, class_id, section_id, session_id, branch_id) VALUES (?, ?, ?, 4, ?)",
                    [studentId, parsed.class_id, parsed.section_id, branch_id]
                );

                // 3. Create login credential (default password matches email or generic)
                const username = parsed.email || `student${studentId}`;
                await pool.execute(
                    "INSERT INTO login_credential (user_id, username, password, role, active) VALUES (?, ?, 'password', 6, 1)",
                    [studentId, username]
                );

                return { content: [{ type: "text", text: `Student created. ID: ${studentId}` }] };
            }

            case "update_student": {
                const parsed = z.object({
                    id: z.number(),
                    first_name: z.string().optional(),
                    last_name: z.string().optional(),
                    register_no: z.string().optional(),
                    admission_date: z.string().optional(),
                    gender: z.string().optional(),
                    birthday: z.string().optional(),
                    mobileno: z.string().optional(),
                    email: z.string().optional(),
                    parent_id: z.number().optional(),
                    class_id: z.number().optional(),
                    section_id: z.number().optional(),
                    category_id: z.number().optional(),
                    religion: z.string().optional(),
                    caste: z.string().optional(),
                    blood_group: z.string().optional(),
                    current_address: z.string().optional(),
                    permanent_address: z.string().optional()
                }).parse(args);

                const updates: string[] = [];
                const params: any[] = [];

                if (parsed.first_name) { updates.push("first_name = ?"); params.push(parsed.first_name); }
                if (parsed.last_name) { updates.push("last_name = ?"); params.push(parsed.last_name); }
                if (parsed.register_no) { updates.push("register_no = ?"); params.push(parsed.register_no); }
                if (parsed.admission_date) { updates.push("admission_date = ?"); params.push(parsed.admission_date); }
                if (parsed.gender) { updates.push("gender = ?"); params.push(parsed.gender); }
                if (parsed.birthday) { updates.push("birthday = ?"); params.push(parsed.birthday); }
                if (parsed.mobileno) { updates.push("mobileno = ?"); params.push(parsed.mobileno); }
                if (parsed.email) { updates.push("email = ?"); params.push(parsed.email); }
                if (parsed.parent_id) { updates.push("parent_id = ?"); params.push(parsed.parent_id); }
                if (parsed.class_id) { updates.push("class = ?"); params.push(parsed.class_id); }
                if (parsed.section_id) { updates.push("section = ?"); params.push(parsed.section_id); }
                if (parsed.category_id !== undefined) { updates.push("category_id = ?"); params.push(parsed.category_id); }
                if (parsed.religion) { updates.push("religion = ?"); params.push(parsed.religion); }
                if (parsed.caste) { updates.push("caste = ?"); params.push(parsed.caste); }
                if (parsed.blood_group) { updates.push("blood_group = ?"); params.push(parsed.blood_group); }
                if (parsed.current_address) { updates.push("current_address = ?"); params.push(parsed.current_address); }
                if (parsed.permanent_address) { updates.push("permanent_address = ?"); params.push(parsed.permanent_address); }

                if (updates.length > 0) {
                    params.push(parsed.id);
                    await pool.execute(`UPDATE student SET ${updates.join(", ")} WHERE id = ?`, params);
                }

                // Update enroll table if class/section changed
                if (parsed.class_id || parsed.section_id) {
                    const enrollUpdates: string[] = [];
                    const enrollParams: any[] = [];
                    if (parsed.class_id) { enrollUpdates.push("class_id = ?"); enrollParams.push(parsed.class_id); }
                    if (parsed.section_id) { enrollUpdates.push("section_id = ?"); enrollParams.push(parsed.section_id); }
                    enrollParams.push(parsed.id); // student_id
                    // Assuming we update current session enrollment
                    await pool.execute(`UPDATE enroll SET ${enrollUpdates.join(", ")} WHERE student_id = ? AND session_id = 4`, enrollParams);
                }

                return { content: [{ type: "text", text: `Student ${parsed.id} updated.` }] };
            }

            // --- Parent Module Implementation ---
            case "list_parents": {
                const parsed = z.object({ branch_id: z.number().optional() }).parse(args);
                let query = "SELECT * FROM parent";
                const params: any[] = [];
                if (parsed.branch_id) { query += " WHERE branch_id = ?"; params.push(parsed.branch_id); }
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "get_parent": {
                const { id } = z.object({ id: z.number() }).parse(args);
                const [rows] = await pool.execute("SELECT * FROM parent WHERE id = ?", [id]);
                return { content: [{ type: "text", text: JSON.stringify((rows as any[])[0] || {}, null, 2) }] };
            }

            case "get_parent_children": {
                const { parent_id } = z.object({ parent_id: z.number() }).parse(args);
                const query = `
                    SELECT s.id, s.first_name, s.last_name, c.name as class_name, se.name as section_name
                    FROM student s
                    JOIN enroll e ON s.id = e.student_id AND e.session_id = 4
                    JOIN class c ON e.class_id = c.id
                    JOIN section se ON e.section_id = se.id
                    WHERE s.parent_id = ?
                `;
                const [rows] = await pool.execute(query, [parent_id]);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "create_parent": {
                const parsed = z.object({
                    name: z.string(), // This might be used as "Guardians Name" or generic name
                    relation: z.string().optional(), // Relation to student
                    father_name: z.string().optional(),
                    mother_name: z.string().optional(),
                    occupation: z.string().optional(), // Additional
                    income: z.string().optional(), // Additional
                    education: z.string().optional(), // Additional
                    mobileno: z.string().optional(),
                    email: z.string().optional(),
                    address: z.string().optional(), // Additional
                    city: z.string().optional(), // Additional
                    state: z.string().optional(), // Additional
                    branch_id: z.number().optional()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;

                const [result] = await pool.execute(
                    `INSERT INTO parent 
                    (name, relation, father_name, mother_name, occupation, income, education, mobileno, email, address, city, state, branch_id, created_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        parsed.name, parsed.relation || 'Guardian', parsed.father_name || '', parsed.mother_name || '',
                        parsed.occupation || '', parsed.income || '', parsed.education || '',
                        parsed.mobileno || '', parsed.email || '',
                        parsed.address || '', parsed.city || '', parsed.state || '',
                        branch_id
                    ]
                );

                const parentId = (result as any).insertId;
                // Create login credential for parent (role 7)
                const username = parsed.email || `parent${parentId}`;
                await pool.execute(
                    "INSERT INTO login_credential (user_id, username, password, role, active) VALUES (?, ?, 'password', 7, 1)",
                    [parentId, username]
                );

                return { content: [{ type: "text", text: `Parent created. ID: ${parentId}` }] };
            }

            case "update_parent": {
                const parsed = z.object({
                    id: z.number(),
                    name: z.string().optional(),
                    relation: z.string().optional(),
                    father_name: z.string().optional(),
                    mother_name: z.string().optional(),
                    occupation: z.string().optional(),
                    income: z.string().optional(),
                    education: z.string().optional(),
                    mobileno: z.string().optional(),
                    email: z.string().optional(),
                    address: z.string().optional(),
                    city: z.string().optional(),
                    state: z.string().optional()
                }).parse(args);
                const updates: string[] = [];
                const params: any[] = [];

                if (parsed.name) { updates.push("name = ?"); params.push(parsed.name); }
                if (parsed.relation) { updates.push("relation = ?"); params.push(parsed.relation); }
                if (parsed.father_name) { updates.push("father_name = ?"); params.push(parsed.father_name); }
                if (parsed.mother_name) { updates.push("mother_name = ?"); params.push(parsed.mother_name); }
                if (parsed.occupation) { updates.push("occupation = ?"); params.push(parsed.occupation); }
                if (parsed.income) { updates.push("income = ?"); params.push(parsed.income); }
                if (parsed.education) { updates.push("education = ?"); params.push(parsed.education); }
                if (parsed.mobileno) { updates.push("mobileno = ?"); params.push(parsed.mobileno); }
                if (parsed.email) { updates.push("email = ?"); params.push(parsed.email); }
                if (parsed.address) { updates.push("address = ?"); params.push(parsed.address); }
                if (parsed.city) { updates.push("city = ?"); params.push(parsed.city); }
                if (parsed.state) { updates.push("state = ?"); params.push(parsed.state); }

                if (updates.length === 0) return { content: [{ type: "text", text: "No changes provided." }] };
                params.push(parsed.id);
                await pool.execute(`UPDATE parent SET ${updates.join(", ")} WHERE id = ?`, params);
                return { content: [{ type: "text", text: `Parent ${parsed.id} updated.` }] };
            }

            // --- Staff Module Implementation ---
            case "list_staff": {
                const parsed = z.object({
                    branch_id: z.number().optional(),
                    role_id: z.number().optional()
                }).parse(args);
                let query = `
                    SELECT s.*, lc.role as role_id, r.name as role_name
                    FROM staff s
                    JOIN login_credential lc ON s.id = lc.user_id AND lc.role NOT IN (6, 7)
                    JOIN roles r ON lc.role = r.id
                `;
                const params: any[] = [];
                const conditions: string[] = [];
                if (parsed.branch_id) { conditions.push("s.branch_id = ?"); params.push(parsed.branch_id); }
                if (parsed.role_id) { conditions.push("lc.role = ?"); params.push(parsed.role_id); }
                if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
                const [rows] = await pool.execute(query, params);
                return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
            }

            case "get_staff": {
                const { id } = z.object({ id: z.number() }).parse(args);
                const query = `
                    SELECT s.*, lc.role as role_id, r.name as role_name
                    FROM staff s
                    JOIN login_credential lc ON s.id = lc.user_id AND lc.role NOT IN (6, 7)
                    JOIN roles r ON lc.role = r.id
                    WHERE s.id = ?
                `;
                const [rows] = await pool.execute(query, [id]);
                return { content: [{ type: "text", text: JSON.stringify((rows as any[])[0] || {}, null, 2) }] };
            }

            case "create_staff": {
                const parsed = z.object({
                    name: z.string(),
                    sex: z.string().optional(),
                    designation_id: z.number().optional(),
                    department_id: z.number().optional(),
                    joining_date: z.string().optional(),
                    mobileno: z.string().optional(),
                    email: z.string().optional(),
                    address: z.string().optional(), // Additional
                    qualification: z.string().optional(), // Additional
                    experience: z.string().optional(), // Additional
                    branch_id: z.number().optional(),
                    role_id: z.number()
                }).parse(args);
                const branch_id = parsed.branch_id || 1;

                // Generate a staff ID if not provided (using current timestamp based random for now)
                const staffCode = `STF${Date.now().toString().slice(-6)}`;

                const [result] = await pool.execute(
                    `INSERT INTO staff 
                    (name, sex, designation, department, joining_date, mobileno, email, address, qualification, work_exp, staff_id, branch_id) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        parsed.name, parsed.sex || 'Male', parsed.designation_id || 0, parsed.department_id || 0,
                        parsed.joining_date || new Date().toISOString().split('T')[0],
                        parsed.mobileno || '', parsed.email || '',
                        parsed.address || '', parsed.qualification || '', parsed.experience || '',
                        staffCode, branch_id
                    ]
                );
                const staffId = (result as any).insertId;

                // Create login credential
                const username = parsed.email || `staff${staffId}`;
                await pool.execute(
                    "INSERT INTO login_credential (user_id, username, password, role, active) VALUES (?, ?, 'password', ?, 1)",
                    [staffId, username, parsed.role_id]
                );
                return { content: [{ type: "text", text: `Staff created. ID: ${staffId}` }] };
            }

            case "update_staff": {
                const parsed = z.object({
                    id: z.number(),
                    name: z.string().optional(),
                    sex: z.string().optional(),
                    designation_id: z.number().optional(),
                    department_id: z.number().optional(),
                    joining_date: z.string().optional(),
                    mobileno: z.string().optional(),
                    email: z.string().optional(),
                    address: z.string().optional(),
                    qualification: z.string().optional(),
                    experience: z.string().optional(),
                    role_id: z.number().optional(),
                    active: z.number().optional()
                }).parse(args);

                const updates: string[] = [];
                const params: any[] = [];

                if (parsed.name) { updates.push("name = ?"); params.push(parsed.name); }
                if (parsed.sex) { updates.push("sex = ?"); params.push(parsed.sex); }
                if (parsed.designation_id !== undefined) { updates.push("designation = ?"); params.push(parsed.designation_id); }
                if (parsed.department_id !== undefined) { updates.push("department = ?"); params.push(parsed.department_id); }
                if (parsed.joining_date) { updates.push("joining_date = ?"); params.push(parsed.joining_date); }
                if (parsed.mobileno) { updates.push("mobileno = ?"); params.push(parsed.mobileno); }
                if (parsed.email) { updates.push("email = ?"); params.push(parsed.email); }
                if (parsed.address) { updates.push("address = ?"); params.push(parsed.address); }
                if (parsed.qualification) { updates.push("qualification = ?"); params.push(parsed.qualification); }
                if (parsed.experience) { updates.push("work_exp = ?"); params.push(parsed.experience); }

                if (updates.length > 0) {
                    params.push(parsed.id);
                    await pool.execute(`UPDATE staff SET ${updates.join(", ")} WHERE id = ?`, params);
                }

                // Update Role/Active Status in login_credential
                if (parsed.role_id !== undefined || parsed.active !== undefined) {
                    const lcUpdates: string[] = [];
                    const lcParams: any[] = [];
                    if (parsed.role_id !== undefined) { lcUpdates.push("role = ?"); lcParams.push(parsed.role_id); }
                    if (parsed.active !== undefined) { lcUpdates.push("active = ?"); lcParams.push(parsed.active); }
                    if (lcUpdates.length > 0) {
                        lcParams.push(parsed.id);
                        await pool.execute(`UPDATE login_credential SET ${lcUpdates.join(", ")} WHERE user_id = ? AND role NOT IN (6, 7)`, lcParams);
                    }
                }

                return { content: [{ type: "text", text: `Staff ${parsed.id} updated.` }] };
            }

            case "list_inquiries": {
                const parsed = z
                    .object({
                        limit: z.number().default(50),
                        offset: z.number().default(0),
                        search: z.string().optional(),
                    })
                    .parse(args);

                let query = "SELECT * FROM enquiry";
                const queryParams: any[] = [];

                if (parsed.search) {
                    query += " WHERE name LIKE ? OR mobile_no LIKE ?";
                    queryParams.push(`%${parsed.search}%`, `%${parsed.search}%`);
                }

                query += " ORDER BY id DESC LIMIT ? OFFSET ?";
                queryParams.push(parsed.limit, parsed.offset);

                const [rows] = await pool.execute(query, queryParams);

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(rows, null, 2),
                        },
                    ],
                };
            }

            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [
                {
                    type: "text",
                    text: `Error: ${errorMessage}`,
                },
            ],
            isError: true,
        };
    }
});

const app = express();
app.use(cors());
app.use(express.json());

let transport: SSEServerTransport | null = null;

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.get('/sse', async (req, res) => {
    console.log("Received connection for /sse");
    const apiKey = req.query.api_key as string;

    // Pass API key to transport via query param in the endpoint URL for client logic if needed,
    // but crucially, we need it for the initial connection if we were validating here.
    // For MCP, the tools ran via /messages, so storage context there is more important.

    transport = new SSEServerTransport(`/messages?api_key=${apiKey || ''}`, res);
    await server.connect(transport);
});

app.post('/messages', async (req, res) => {
    console.log("Received message on /messages");
    const apiKey = req.query.api_key as string;

    if (transport) {
        // Run handlePostMessage within the AsyncLocalStorage context with the apiKey
        await storage.run(apiKey, async () => {
            await transport!.handlePostMessage(req, res);
        });
    } else {
        res.status(400).json({ error: "No active transport" });
    }
});

app.get('/', (req, res) => {
    const host = req.get('host');
    const protocol = req.protocol;
    const baseUrl = `https://${host}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gurukul AI MCP Server</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; }
        .status { display: inline-block; padding: 5px 10px; border-radius: 4px; background: #e8f5e9; color: #2e7d32; font-weight: bold; font-size: 0.9em; margin-bottom: 20px; }
        .config-box { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; padding: 15px; position: relative; }
        pre { margin: 0; white-space: pre-wrap; word-wrap: break-word; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 0.9em; color: #24292e; }
        button { background: #0366d6; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 0.9em; }
        button:hover { background: #0255b3; }
        input[type="text"] { width: 100%; padding: 10px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-size: 16px; }
        .copy-btn { position: absolute; top: 10px; right: 10px; }
        .note { font-size: 0.85em; color: #666; margin-top: 5px; }
    </style>
</head>
<body>
    <h1>Gurukul AI MCP Server</h1>
    <div class="status">● System Online</div>
    
    <p>This server provides Model Context Protocol (MCP) access to the Gurukul RAMOM system.</p>

    <div style="margin-bottom: 25px;">
        <label for="apiKey" style="font-weight: bold; display: block; margin-bottom: 5px;">Enter your Ramom API Key:</label>
        <input type="text" id="apiKey" placeholder="rmm_xxxxxxxxxxxxxxxx" oninput="updateConfig()">
        <div class="note">Your API Key is used to securely connect to the RAMOM database. It is not stored on this server.</div>
    </div>

    <h3>Client Configuration</h3>
    <p>Copy this JSON into your MCP client configuration (e.g., <code>claude_desktop_config.json</code>):</p>
    
    <div class="config-box">
        <button class="copy-btn" onclick="copyConfig()">Copy</button>
        <pre id="configBlock">{
  "mcpServers": {
    "gurukul-ai": {
      "endpoint": "${baseUrl}/sse",
      "type": "sse"
    }
  }
}</pre>
    </div>

    <script>
        const baseUrl = "${baseUrl}";
        
        function updateConfig() {
            const key = document.getElementById('apiKey').value.trim();
            const endpoint = key ? \`\${baseUrl}/sse?api_key=\${key}\` : \`\${baseUrl}/sse\`;
            
            const config = {
                "mcpServers": {
                    "gurukul-ai": {
                        "endpoint": endpoint,
                        "type": "sse"
                    }
                }
            };
            
            document.getElementById('configBlock').textContent = JSON.stringify(config, null, 2);
        }

        function copyConfig() {
            const text = document.getElementById('configBlock').textContent;
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.querySelector('.copy-btn');
                const original = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = original, 2000);
            });
        }
    </script>
</body>
</html>
    `;

    res.send(html);
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

export default app;
