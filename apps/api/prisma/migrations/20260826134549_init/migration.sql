-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_STOCK', 'ALLOCATED', 'IN_REPAIR', 'IN_TRANSIT', 'RESERVED', 'LOST', 'STOLEN', 'SCRAPPED', 'RETIRED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'BEYOND_REPAIR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('OWNED', 'LEASED', 'RENTED', 'VENDOR_SUPPLIED', 'EMPLOYEE_OWNED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('ACTIVE', 'RETURNED', 'TRANSFERRED', 'LOST_IN_CUSTODY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationHolderType" AS ENUM ('EMPLOYEE', 'DEPARTMENT', 'WORKSTATION', 'LOCATION', 'VENDOR');

-- CreateEnum
CREATE TYPE "AssetEventType" AS ENUM ('CREATED', 'IMPORTED', 'UPDATED', 'ALLOCATED', 'RETURNED', 'TRANSFERRED', 'SENT_FOR_REPAIR', 'REPAIR_COMPLETED', 'REPAIR_FAILED', 'DAMAGE_REPORTED', 'CONDITION_CHANGED', 'STATUS_CHANGED', 'LOCATION_CHANGED', 'AUDIT_VERIFIED', 'AUDIT_MISSING', 'SCRAPPED', 'ARCHIVED', 'RESTORED', 'COMMENT');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_PROBATION', 'ON_LEAVE', 'ON_NOTICE', 'RESIGNED', 'TERMINATED', 'ABSCONDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RepairStatus" AS ENUM ('REPORTED', 'APPROVED', 'SENT_TO_VENDOR', 'IN_PROGRESS', 'AWAITING_PARTS', 'REPAIRED', 'RETURNED_TO_STOCK', 'UNREPAIRABLE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('NEW_ASSET', 'REPLACEMENT', 'REPAIR', 'RETURN', 'ACCESSORY', 'WORKSPACE', 'LOCKER', 'CUG', 'HEADPHONE', 'OTHER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'MANAGER_APPROVED', 'ADMIN_APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChangeRequestType" AS ENUM ('ASSET_DELETE', 'BULK_UPDATE', 'INVENTORY_ADJUSTMENT', 'STOCK_REDUCTION', 'ALLOCATION_OVERRIDE', 'DATA_IMPORT', 'PERMANENT_DELETE', 'ROLE_CHANGE');

-- CreateEnum
CREATE TYPE "ApprovalStage" AS ENUM ('MANAGER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'HARD_DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'MFA_ENABLED', 'MFA_DISABLED', 'ROLE_ASSIGNED', 'ROLE_REVOKED', 'PERMISSION_CHANGED', 'EXPORT', 'IMPORT', 'SYNC', 'BACKUP', 'RESTORE_BACKUP', 'APPROVE', 'REJECT', 'ALLOCATE', 'RETURN', 'TRANSFER', 'VIEW_SENSITIVE', 'SETTING_CHANGED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MANUAL', 'GOOGLE_SHEET', 'EXCEL_UPLOAD', 'CSV_UPLOAD', 'API', 'SEED');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('MANUAL', 'SCHEDULED', 'ONE_TIME_MIGRATION');

-- CreateEnum
CREATE TYPE "SyncSchedule" AS ENUM ('OFF', 'HOURLY', 'SIX_HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'AWAITING_CONFIRMATION', 'SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncRowStatus" AS ENUM ('NEW', 'IMPORTED', 'UPDATED', 'UNCHANGED', 'DUPLICATE', 'INVALID', 'CONFLICT', 'SKIPPED');

-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('DAILY', 'WEEKLY', 'MANUAL', 'PRE_MIGRATION', 'PRE_RESTORE');

-- CreateEnum
CREATE TYPE "BackupFormat" AS ENUM ('PG_DUMP', 'EXCEL', 'CSV');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PRUNED');

-- CreateEnum
CREATE TYPE "WorkstationStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'UNDER_MAINTENANCE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "LockerStatus" AS ENUM ('AVAILABLE', 'ALLOCATED', 'UNDER_MAINTENANCE', 'DAMAGED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CugStatus" AS ENUM ('AVAILABLE', 'ALLOCATED', 'SUSPENDED', 'BARRED', 'DEACTIVATED', 'LOST');

-- CreateEnum
CREATE TYPE "StockTxnType" AS ENUM ('OPENING_BALANCE', 'PURCHASE_IN', 'ISSUE_OUT', 'RETURN_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE_OUT', 'SCRAP_OUT', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSET_ALLOCATED', 'ASSET_RETURN_DUE', 'REPAIR_UPDATE', 'APPROVAL_PENDING', 'APPROVAL_DECIDED', 'REQUEST_UPDATE', 'SYNC_COMPLETED', 'SYNC_FAILED', 'BACKUP_FAILED', 'WARRANTY_EXPIRING', 'AMC_EXPIRING', 'STOCK_LOW', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('CAMPUS', 'BUILDING', 'WING', 'FLOOR', 'ROOM', 'ZONE', 'STORE');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "logoUrl" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteType" TEXT NOT NULL DEFAULT 'CAMPUS',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "pincode" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "parentId" UUID,
    "kind" "LocationKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "fullName" TEXT NOT NULL,
    "officialEmail" TEXT,
    "personalEmail" TEXT,
    "phone" TEXT,
    "alternatePhone" TEXT,
    "gender" TEXT,
    "bloodGroup" TEXT,
    "dateOfBirth" DATE,
    "dateOfJoining" DATE,
    "dateOfLeaving" DATE,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "employmentType" TEXT,
    "branchId" UUID,
    "departmentId" UUID,
    "designationId" UUID,
    "reportingManagerId" UUID,
    "process" TEXT,
    "shift" TEXT,
    "seatNumber" TEXT,
    "photoUrl" TEXT,
    "address" TEXT,
    "remarks" TEXT,
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "externalRefs" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "employeeId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "passwordChangedAt" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEnc" TEXT,
    "mfaRecoveryCodes" JSONB NOT NULL DEFAULT '[]',
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 100,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" UUID,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_scopes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "replacedByHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_history" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "emailTried" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "mfaUsed" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "tagPrefix" TEXT,
    "requiresSerial" BOOLEAN NOT NULL DEFAULT true,
    "isConsumable" BOOLEAN NOT NULL DEFAULT false,
    "defaultLifespanMonths" INTEGER,
    "depreciationRatePct" DECIMAL(5,2),
    "specSchema" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "vendorType" TEXT NOT NULL DEFAULT 'BOTH',
    "rating" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "poNumber" TEXT NOT NULL,
    "vendorId" UUID,
    "poDate" DATE,
    "invoiceNo" TEXT,
    "invoiceDate" DATE,
    "totalAmount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "attachmentId" UUID,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "assetTag" TEXT NOT NULL,
    "serialNumber" TEXT,
    "qrCode" TEXT,
    "categoryId" UUID NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "condition" "AssetCondition" NOT NULL DEFAULT 'UNKNOWN',
    "ownership" "OwnershipType" NOT NULL DEFAULT 'OWNED',
    "branchId" UUID,
    "locationId" UUID,
    "currentHolderEmployeeId" UUID,
    "currentAllocationId" UUID,
    "vendorId" UUID,
    "purchaseOrderId" UUID,
    "purchaseDate" DATE,
    "purchaseCost" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "warrantyEndsAt" DATE,
    "amcVendorId" UUID,
    "amcEndsAt" DATE,
    "expectedLifeMonths" INTEGER,
    "parentAssetId" UUID,
    "notes" TEXT,
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "externalRefs" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_allocations" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "holderType" "AllocationHolderType" NOT NULL DEFAULT 'EMPLOYEE',
    "employeeId" UUID,
    "holderRefId" UUID,
    "holderLabel" TEXT,
    "status" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocatedAt" TIMESTAMP(3) NOT NULL,
    "allocatedById" UUID,
    "conditionOut" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "expectedReturnAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnedToById" UUID,
    "conditionIn" "AssetCondition",
    "returnRemarks" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementRef" TEXT,
    "remarks" TEXT,
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "voidReason" TEXT,

    CONSTRAINT "asset_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "eventType" "AssetEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "fromValue" JSONB,
    "toValue" JSONB,
    "refType" TEXT,
    "refId" UUID,
    "actorUserId" UUID,
    "actorName" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_tickets" (
    "id" UUID NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "assetId" UUID NOT NULL,
    "reportedById" UUID,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "faultCategory" TEXT,
    "faultDescription" TEXT NOT NULL,
    "status" "RepairStatus" NOT NULL DEFAULT 'REPORTED',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "vendorId" UUID,
    "sentToVendorAt" TIMESTAMP(3),
    "expectedBackAt" TIMESTAMP(3),
    "receivedBackAt" TIMESTAMP(3),
    "estimatedCost" DECIMAL(14,2),
    "actualCost" DECIMAL(14,2),
    "underWarranty" BOOLEAN NOT NULL DEFAULT false,
    "chargedToEmployee" BOOLEAN NOT NULL DEFAULT false,
    "recoveryAmount" DECIMAL(14,2),
    "resolution" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "repair_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_logs" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "fromStatus" "RepairStatus",
    "toStatus" "RepairStatus" NOT NULL,
    "note" TEXT,
    "actorUserId" UUID,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_reports" (
    "id" UUID NOT NULL,
    "reportNo" TEXT NOT NULL,
    "assetId" UUID NOT NULL,
    "reportedById" UUID,
    "occurredAt" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MINOR',
    "repairTicketId" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "headphone_details" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "connectivity" TEXT NOT NULL DEFAULT 'WIRED',
    "earStyle" TEXT,
    "hasMic" BOOLEAN NOT NULL DEFAULT true,
    "hasNoiseCancellation" BOOLEAN NOT NULL DEFAULT false,
    "cushionReplacedAt" DATE,
    "isPersonalIssue" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "headphone_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workstations" (
    "id" UUID NOT NULL,
    "assetId" UUID,
    "branchId" UUID NOT NULL,
    "locationId" UUID,
    "seatCode" TEXT NOT NULL,
    "row" TEXT,
    "column" TEXT,
    "status" "WorkstationStatus" NOT NULL DEFAULT 'AVAILABLE',
    "isHotDesk" BOOLEAN NOT NULL DEFAULT false,
    "hasDesktop" BOOLEAN NOT NULL DEFAULT false,
    "hasPhone" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "workstations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workstation_allocations" (
    "id" UUID NOT NULL,
    "workstationId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "shift" TEXT,
    "status" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "workstation_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lockers" (
    "id" UUID NOT NULL,
    "assetId" UUID,
    "branchId" UUID NOT NULL,
    "locationId" UUID,
    "lockerNo" TEXT NOT NULL,
    "bankOrRow" TEXT,
    "size" TEXT,
    "lockType" TEXT NOT NULL DEFAULT 'KEY',
    "keyNumber" TEXT,
    "spareKeyWith" TEXT,
    "status" "LockerStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "lockers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locker_allocations" (
    "id" UUID NOT NULL,
    "lockerId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "keyIssued" BOOLEAN NOT NULL DEFAULT true,
    "keyReturned" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "locker_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cug_connections" (
    "id" UUID NOT NULL,
    "assetId" UUID,
    "branchId" UUID NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "simNumber" TEXT,
    "operator" TEXT,
    "planName" TEXT,
    "planRentAmount" DECIMAL(10,2),
    "creditLimit" DECIMAL(10,2),
    "activatedOn" DATE,
    "status" "CugStatus" NOT NULL DEFAULT 'AVAILABLE',
    "isDataEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isIsdEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "cug_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cug_allocations" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "handsetAssetId" UUID,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "cug_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" UUID,
    "branchId" UUID NOT NULL,
    "locationId" UUID,
    "unit" TEXT NOT NULL DEFAULT 'NOS',
    "quantityOnHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transactions" (
    "id" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "txnType" "StockTxnType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "balanceAfter" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,2),
    "employeeId" UUID,
    "refType" TEXT,
    "refId" UUID,
    "remarks" TEXT,
    "actorUserId" UUID,
    "actorName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_requests" (
    "id" UUID NOT NULL,
    "requestNo" TEXT NOT NULL,
    "requestType" "RequestType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" UUID NOT NULL,
    "departmentId" UUID,
    "categoryId" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "justification" TEXT,
    "neededBy" DATE,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "fulfilledAssetIds" JSONB NOT NULL DEFAULT '[]',
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledById" UUID,
    "approvalRequestId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "asset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "requestNo" TEXT NOT NULL,
    "changeType" "ChangeRequestType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "targetTable" TEXT,
    "targetId" UUID,
    "targetLabel" TEXT,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "riskNote" TEXT,
    "affectedCount" INTEGER NOT NULL DEFAULT 1,
    "raisedById" UUID NOT NULL,
    "raisedByName" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "applyError" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "stage" "ApprovalStage" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "assignedUserId" UUID,
    "assignedRoleKey" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_audits" (
    "id" UUID NOT NULL,
    "auditNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "branchId" UUID,
    "locationId" UUID,
    "scheduledFor" DATE,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "conductedById" UUID,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "physical_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_audit_lines" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "expectedLocationId" UUID,
    "foundLocationId" UUID,
    "finding" TEXT NOT NULL DEFAULT 'PENDING',
    "scannedAt" TIMESTAMP(3),
    "scannedById" UUID,
    "conditionFound" "AssetCondition",
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "physical_audit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "entityLabel" TEXT,
    "userId" UUID,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT,
    "roleKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "sessionId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT,
    "assetId" UUID,
    "allocationId" UUID,
    "repairTicketId" UUID,
    "damageReportId" UUID,
    "assetRequestId" UUID,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkUrl" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "sync_sources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'GOOGLE_SHEET',
    "spreadsheetId" TEXT,
    "sheetGid" TEXT,
    "sheetName" TEXT,
    "workbookLabel" TEXT,
    "targetEntity" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "dedupeKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mode" "SyncMode" NOT NULL DEFAULT 'MANUAL',
    "schedule" "SyncSchedule" NOT NULL DEFAULT 'OFF',
    "isDisconnected" BOOLEAN NOT NULL DEFAULT false,
    "disconnectedAt" TIMESTAMP(3),
    "disconnectedById" UUID,
    "dryRunDefault" BOOLEAN NOT NULL DEFAULT false,
    "allowUpdates" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastRowCount" INTEGER,
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "sync_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_column_mappings" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "sourceHeader" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "transform" TEXT NOT NULL DEFAULT 'trim',
    "transformArg" JSONB NOT NULL DEFAULT '{}',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "isIgnored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_column_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "mode" "SyncMode" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "triggeredById" UUID,
    "triggeredByName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsNew" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "rowsDuplicate" INTEGER NOT NULL DEFAULT 0,
    "rowsInvalid" INTEGER NOT NULL DEFAULT 0,
    "rowsConflict" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "confirmationToken" TEXT,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "errorDetail" JSONB,
    "preRunBackupId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_rows" (
    "id" BIGSERIAL NOT NULL,
    "runId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalized" JSONB,
    "rowHash" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "status" "SyncRowStatus" NOT NULL,
    "entityType" TEXT,
    "entityId" UUID,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "type" "BackupType" NOT NULL,
    "format" "BackupFormat" NOT NULL DEFAULT 'PG_DUMP',
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "filePath" TEXT,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "tableCounts" JSONB NOT NULL DEFAULT '{}',
    "retainUntil" TIMESTAMP(3),
    "prunedAt" TIMESTAMP(3),
    "triggeredById" UUID,
    "triggeredByName" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE INDEX "organizations_deletedAt_idx" ON "organizations"("deletedAt");

-- CreateIndex
CREATE INDEX "branches_deletedAt_idx" ON "branches"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organizationId_code_key" ON "branches"("organizationId", "code");

-- CreateIndex
CREATE INDEX "locations_path_idx" ON "locations"("path");

-- CreateIndex
CREATE INDEX "locations_parentId_idx" ON "locations"("parentId");

-- CreateIndex
CREATE INDEX "locations_kind_idx" ON "locations"("kind");

-- CreateIndex
CREATE INDEX "locations_deletedAt_idx" ON "locations"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "locations_branchId_code_key" ON "locations"("branchId", "code");

-- CreateIndex
CREATE INDEX "departments_deletedAt_idx" ON "departments"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organizationId_code_key" ON "departments"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "designations_code_key" ON "designations"("code");

-- CreateIndex
CREATE INDEX "employees_fullName_idx" ON "employees"("fullName");

-- CreateIndex
CREATE INDEX "employees_officialEmail_idx" ON "employees"("officialEmail");

-- CreateIndex
CREATE INDEX "employees_phone_idx" ON "employees"("phone");

-- CreateIndex
CREATE INDEX "employees_branchId_departmentId_idx" ON "employees"("branchId", "departmentId");

-- CreateIndex
CREATE INDEX "employees_employmentStatus_idx" ON "employees"("employmentStatus");

-- CreateIndex
CREATE INDEX "employees_deletedAt_idx" ON "employees"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organizationId_employeeCode_key" ON "employees"("organizationId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeId_key" ON "users"("employeeId");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_scopes_userId_branchId_key" ON "user_scopes"("userId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "login_history_userId_createdAt_idx" ON "login_history"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "login_history_emailTried_createdAt_idx" ON "login_history"("emailTried", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_code_key" ON "asset_categories"("code");

-- CreateIndex
CREATE INDEX "asset_categories_deletedAt_idx" ON "asset_categories"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_code_key" ON "vendors"("code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_poNumber_key" ON "purchase_orders"("poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "assets_assetTag_key" ON "assets"("assetTag");

-- CreateIndex
CREATE UNIQUE INDEX "assets_qrCode_key" ON "assets"("qrCode");

-- CreateIndex
CREATE INDEX "assets_categoryId_status_idx" ON "assets"("categoryId", "status");

-- CreateIndex
CREATE INDEX "assets_branchId_locationId_idx" ON "assets"("branchId", "locationId");

-- CreateIndex
CREATE INDEX "assets_serialNumber_idx" ON "assets"("serialNumber");

-- CreateIndex
CREATE INDEX "assets_currentHolderEmployeeId_idx" ON "assets"("currentHolderEmployeeId");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_deletedAt_idx" ON "assets"("deletedAt");

-- CreateIndex
CREATE INDEX "assets_warrantyEndsAt_idx" ON "assets"("warrantyEndsAt");

-- CreateIndex
CREATE INDEX "asset_allocations_assetId_status_idx" ON "asset_allocations"("assetId", "status");

-- CreateIndex
CREATE INDEX "asset_allocations_employeeId_status_idx" ON "asset_allocations"("employeeId", "status");

-- CreateIndex
CREATE INDEX "asset_allocations_allocatedAt_idx" ON "asset_allocations"("allocatedAt");

-- CreateIndex
CREATE INDEX "asset_events_assetId_occurredAt_idx" ON "asset_events"("assetId", "occurredAt");

-- CreateIndex
CREATE INDEX "asset_events_eventType_idx" ON "asset_events"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "repair_tickets_ticketNo_key" ON "repair_tickets"("ticketNo");

-- CreateIndex
CREATE INDEX "repair_tickets_assetId_status_idx" ON "repair_tickets"("assetId", "status");

-- CreateIndex
CREATE INDEX "repair_tickets_status_reportedAt_idx" ON "repair_tickets"("status", "reportedAt");

-- CreateIndex
CREATE INDEX "repair_tickets_deletedAt_idx" ON "repair_tickets"("deletedAt");

-- CreateIndex
CREATE INDEX "repair_logs_ticketId_createdAt_idx" ON "repair_logs"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "damage_reports_reportNo_key" ON "damage_reports"("reportNo");

-- CreateIndex
CREATE INDEX "damage_reports_assetId_idx" ON "damage_reports"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "headphone_details_assetId_key" ON "headphone_details"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "workstations_assetId_key" ON "workstations"("assetId");

-- CreateIndex
CREATE INDEX "workstations_status_idx" ON "workstations"("status");

-- CreateIndex
CREATE INDEX "workstations_deletedAt_idx" ON "workstations"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workstations_branchId_seatCode_key" ON "workstations"("branchId", "seatCode");

-- CreateIndex
CREATE INDEX "workstation_allocations_workstationId_status_idx" ON "workstation_allocations"("workstationId", "status");

-- CreateIndex
CREATE INDEX "workstation_allocations_employeeId_status_idx" ON "workstation_allocations"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lockers_assetId_key" ON "lockers"("assetId");

-- CreateIndex
CREATE INDEX "lockers_status_idx" ON "lockers"("status");

-- CreateIndex
CREATE INDEX "lockers_deletedAt_idx" ON "lockers"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lockers_branchId_lockerNo_key" ON "lockers"("branchId", "lockerNo");

-- CreateIndex
CREATE INDEX "locker_allocations_lockerId_status_idx" ON "locker_allocations"("lockerId", "status");

-- CreateIndex
CREATE INDEX "locker_allocations_employeeId_status_idx" ON "locker_allocations"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cug_connections_assetId_key" ON "cug_connections"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "cug_connections_mobileNumber_key" ON "cug_connections"("mobileNumber");

-- CreateIndex
CREATE INDEX "cug_connections_status_idx" ON "cug_connections"("status");

-- CreateIndex
CREATE INDEX "cug_connections_deletedAt_idx" ON "cug_connections"("deletedAt");

-- CreateIndex
CREATE INDEX "cug_allocations_connectionId_status_idx" ON "cug_allocations"("connectionId", "status");

-- CreateIndex
CREATE INDEX "cug_allocations_employeeId_status_idx" ON "cug_allocations"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_sku_key" ON "stock_items"("sku");

-- CreateIndex
CREATE INDEX "stock_items_branchId_idx" ON "stock_items"("branchId");

-- CreateIndex
CREATE INDEX "stock_items_deletedAt_idx" ON "stock_items"("deletedAt");

-- CreateIndex
CREATE INDEX "stock_transactions_stockItemId_occurredAt_idx" ON "stock_transactions"("stockItemId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "asset_requests_requestNo_key" ON "asset_requests"("requestNo");

-- CreateIndex
CREATE UNIQUE INDEX "asset_requests_approvalRequestId_key" ON "asset_requests"("approvalRequestId");

-- CreateIndex
CREATE INDEX "asset_requests_status_requestType_idx" ON "asset_requests"("status", "requestType");

-- CreateIndex
CREATE INDEX "asset_requests_requestedById_idx" ON "asset_requests"("requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_requestNo_key" ON "approval_requests"("requestNo");

-- CreateIndex
CREATE INDEX "approval_requests_status_changeType_idx" ON "approval_requests"("status", "changeType");

-- CreateIndex
CREATE INDEX "approval_requests_targetTable_targetId_idx" ON "approval_requests"("targetTable", "targetId");

-- CreateIndex
CREATE INDEX "approval_steps_status_assignedRoleKey_idx" ON "approval_steps"("status", "assignedRoleKey");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_requestId_sequence_key" ON "approval_steps"("requestId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "physical_audits_auditNo_key" ON "physical_audits"("auditNo");

-- CreateIndex
CREATE INDEX "physical_audit_lines_finding_idx" ON "physical_audit_lines"("finding");

-- CreateIndex
CREATE UNIQUE INDEX "physical_audit_lines_auditId_assetId_key" ON "physical_audit_lines"("auditId", "assetId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "attachments_assetId_idx" ON "attachments"("assetId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "sync_sources_targetEntity_idx" ON "sync_sources"("targetEntity");

-- CreateIndex
CREATE UNIQUE INDEX "sync_sources_spreadsheetId_sheetGid_key" ON "sync_sources"("spreadsheetId", "sheetGid");

-- CreateIndex
CREATE UNIQUE INDEX "sync_column_mappings_sourceId_sourceHeader_key" ON "sync_column_mappings"("sourceId", "sourceHeader");

-- CreateIndex
CREATE INDEX "sync_runs_sourceId_startedAt_idx" ON "sync_runs"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "sync_runs_status_idx" ON "sync_runs"("status");

-- CreateIndex
CREATE INDEX "sync_rows_runId_status_idx" ON "sync_rows"("runId", "status");

-- CreateIndex
CREATE INDEX "sync_rows_dedupeKey_idx" ON "sync_rows"("dedupeKey");

-- CreateIndex
CREATE INDEX "sync_rows_rowHash_idx" ON "sync_rows"("rowHash");

-- CreateIndex
CREATE INDEX "backup_runs_type_startedAt_idx" ON "backup_runs"("type", "startedAt");

-- CreateIndex
CREATE INDEX "backup_runs_status_idx" ON "backup_runs"("status");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_reportingManagerId_fkey" FOREIGN KEY ("reportingManagerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_allocations" ADD CONSTRAINT "asset_allocations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_allocations" ADD CONSTRAINT "asset_allocations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_logs" ADD CONSTRAINT "repair_logs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "repair_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "headphone_details" ADD CONSTRAINT "headphone_details_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workstations" ADD CONSTRAINT "workstations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workstation_allocations" ADD CONSTRAINT "workstation_allocations_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workstation_allocations" ADD CONSTRAINT "workstation_allocations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lockers" ADD CONSTRAINT "lockers_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lockers" ADD CONSTRAINT "lockers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lockers" ADD CONSTRAINT "lockers_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locker_allocations" ADD CONSTRAINT "locker_allocations_lockerId_fkey" FOREIGN KEY ("lockerId") REFERENCES "lockers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locker_allocations" ADD CONSTRAINT "locker_allocations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cug_connections" ADD CONSTRAINT "cug_connections_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cug_connections" ADD CONSTRAINT "cug_connections_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cug_allocations" ADD CONSTRAINT "cug_allocations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "cug_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cug_allocations" ADD CONSTRAINT "cug_allocations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_audit_lines" ADD CONSTRAINT "physical_audit_lines_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "physical_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_audit_lines" ADD CONSTRAINT "physical_audit_lines_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "asset_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_repairTicketId_fkey" FOREIGN KEY ("repairTicketId") REFERENCES "repair_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_damageReportId_fkey" FOREIGN KEY ("damageReportId") REFERENCES "damage_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_assetRequestId_fkey" FOREIGN KEY ("assetRequestId") REFERENCES "asset_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_column_mappings" ADD CONSTRAINT "sync_column_mappings_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sync_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sync_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_rows" ADD CONSTRAINT "sync_rows_runId_fkey" FOREIGN KEY ("runId") REFERENCES "sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

