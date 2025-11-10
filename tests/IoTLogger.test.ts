import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV } from "@stacks/transactions";
const ERR_NOT_ORACLE = 400;
const ERR_INVALID_FARM_ID = 401;
const ERR_INVALID_PESTICIDE_TYPE = 402;
const ERR_INVALID_AMOUNT = 403;
const ERR_INVALID_TIMESTAMP = 404;
const ERR_INVALID_SENSOR_HASH = 405;
const ERR_FARM_NOT_REGISTERED = 406;
const ERR_LOG_ALREADY_EXISTS = 407;
const ERR_INVALID_LOG_KEY = 408;
const ERR_BATCH_EMPTY = 409;
const ERR_BATCH_OVERFLOW = 410;
const ERR_ORACLE_NOT_SET = 411;
const ERR_INVALID_ORACLE = 412;
const ERR_MAX_LOGS_PER_FARM = 413;
const ERR_INVALID_QUERY_RANGE = 414;
const ERR_UNAUTHORIZED_ADMIN = 415;
const ERR_PAST_TIMESTAMP = 416;
interface LogEntry {
  pesticideType: string;
  amountKg: number;
  appliedAt: number;
  sensorHash: string;
  verified: boolean;
}
interface LogKey {
  farmId: number;
  timestamp: number;
}
interface FarmLogCount {
  count: number;
}
interface OracleEntry {
  principal: string;
  active: boolean;
}
interface BatchLogEntry {
  farmId: number;
  pesticideType: string;
  amountKg: number;
  timestamp: number;
  sensorHash: string;
}
interface Result<T> {
  ok: boolean;
  value: T;
}
class IoTLoggerMock {
  state: {
    oracleContract: string | null;
    maxLogsPerFarm: number;
    maxBatchSize: number;
    admin: string;
    logs: Map<string, LogEntry>;
    farmLogs: Map<number, number[]>;
    oracles: Map<number, OracleEntry>;
    principalToId: Map<string, number>;
    nextOracleId: number;
  } = {
    oracleContract: null,
    maxLogsPerFarm: 1000,
    maxBatchSize: 50,
    admin: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    logs: new Map(),
    farmLogs: new Map(),
    oracles: new Map(),
    principalToId: new Map(),
    nextOracleId: 0,
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  constructor() {
    this.reset();
  }
  reset() {
    this.state = {
      oracleContract: null,
      maxLogsPerFarm: 1000,
      maxBatchSize: 50,
      admin: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      logs: new Map(),
      farmLogs: new Map(),
      oracles: new Map(),
      principalToId: new Map(),
      nextOracleId: 0,
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
  }
  setOracleContract(newOracle: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED_ADMIN };
    this.state.oracleContract = newOracle;
    return { ok: true, value: true };
  }
  addOracle(oraclePrincipal: string): Result<number> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED_ADMIN };
    if (this.state.principalToId.has(oraclePrincipal)) return { ok: false, value: ERR_INVALID_ORACLE };
    const nextId = this.state.nextOracleId;
    this.state.oracles.set(nextId, { principal: oraclePrincipal, active: true });
    this.state.principalToId.set(oraclePrincipal, nextId);
    this.state.nextOracleId++;
    return { ok: true, value: nextId };
  }
  deactivateOracle(oracleId: number): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED_ADMIN };
    const oracleEntry = this.state.oracles.get(oracleId);
    if (!oracleEntry) return { ok: false, value: ERR_INVALID_ORACLE };
    this.state.oracles.set(oracleId, { ...oracleEntry, active: false });
    return { ok: true, value: true };
  }
  setMaxLogsPerFarm(newMax: number): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED_ADMIN };
    if (newMax <= 0) return { ok: false, value: ERR_INVALID_LOG_KEY };
    this.state.maxLogsPerFarm = newMax;
    return { ok: true, value: true };
  }
  setMaxBatchSize(newMax: number): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED_ADMIN };
    if (newMax <= 0 || newMax > 100) return { ok: false, value: ERR_INVALID_LOG_KEY };
    this.state.maxBatchSize = newMax;
    return { ok: true, value: true };
  }
  isOracle(caller: string): boolean {
    const id = this.state.principalToId.get(caller);
    if (id === undefined) return false;
    const entry = this.state.oracles.get(id);
    return entry ? entry.active : false;
  }
  validateFarmRegistered(farmId: number): Result<boolean> {
    return { ok: true, value: true };
  }
  logApplication(
    farmId: number,
    pesticideType: string,
    amountKg: number,
    timestamp: number,
    sensorHash: string
  ): Result<LogKey> {
    if (!this.state.oracleContract) return { ok: false, value: ERR_ORACLE_NOT_SET };
    if (!this.isOracle(this.caller)) return { ok: false, value: ERR_NOT_ORACLE };
    if (!this.validateFarmRegistered(farmId).ok) return { ok: false, value: ERR_FARM_NOT_REGISTERED };
    if (!["glyphosate", "atrazine", "chlorpyrifos", "imidacloprid", "none"].includes(pesticideType)) return { ok: false, value: ERR_INVALID_PESTICIDE_TYPE };
    if (amountKg <= 0 || amountKg > 10000) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (timestamp < this.blockHeight) return { ok: false, value: ERR_PAST_TIMESTAMP };
    if (sensorHash.length !== 64) return { ok: false, value: ERR_INVALID_SENSOR_HASH };
    const current = this.state.farmLogs.get(farmId) || [];
    if (current.length >= this.state.maxLogsPerFarm) return { ok: false, value: ERR_MAX_LOGS_PER_FARM };
    const key = `${farmId}-${timestamp}`;
    if (this.state.logs.has(key)) return { ok: false, value: ERR_LOG_ALREADY_EXISTS };
    this.state.logs.set(key, {
      pesticideType,
      amountKg,
      appliedAt: this.blockHeight,
      sensorHash,
      verified: true,
    });
    this.state.farmLogs.set(farmId, [...current, timestamp]);
    return { ok: true, value: { farmId, timestamp } };
  }
  batchLogApplications(logsBatch: BatchLogEntry[]): Result<number> {
    if (!this.state.oracleContract) return { ok: false, value: ERR_ORACLE_NOT_SET };
    if (!this.isOracle(this.caller)) return { ok: false, value: ERR_NOT_ORACLE };
    if (logsBatch.length === 0) return { ok: false, value: ERR_BATCH_EMPTY };
    if (logsBatch.length > this.state.maxBatchSize) return { ok: false, value: ERR_BATCH_OVERFLOW };
    let successCount = 0;
    for (const entry of logsBatch) {
      const result = this.logApplication(
        entry.farmId,
        entry.pesticideType,
        entry.amountKg,
        entry.timestamp,
        entry.sensorHash
      );
      if (!result.ok) return { ok: false, value: result.value };
      successCount++;
    }
    return { ok: true, value: successCount };
  }
  getLog(farmId: number, timestamp: number): LogEntry | null {
    const key = `${farmId}-${timestamp}`;
    return this.state.logs.get(key) || null;
  }
  getFarmLogCount(farmId: number): Result<number> {
    return { ok: true, value: this.state.farmLogs.get(farmId)?.length || 0 };
  }
  getLogsForFarm(farmId: number, startTs: number, endTs: number): LogKey[] {
    if (endTs < startTs) return [];
    const allTs = this.state.farmLogs.get(farmId) || [];
    const filtered = allTs.filter(ts => ts >= startTs && ts <= endTs);
    return filtered.map(ts => ({ farmId, timestamp: ts }));
  }
  getTotalPesticideForPeriod(farmId: number, startTs: number, endTs: number): number {
    const relevantLogs = this.getLogsForFarm(farmId, startTs, endTs);
    let total = 0;
    for (const key of relevantLogs) {
      const log = this.getLog(key.farmId, key.timestamp);
      if (log) total += log.amountKg;
    }
    return total;
  }
  verifyLog(farmId: number, timestamp: number, verified: boolean): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: ERR_UNAUTHORIZED_ADMIN };
    const key = `${farmId}-${timestamp}`;
    const logEntry = this.state.logs.get(key);
    if (!logEntry) return { ok: false, value: ERR_INVALID_LOG_KEY };
    this.state.logs.set(key, { ...logEntry, verified });
    return { ok: true, value: true };
  }
}
describe("IoTLogger", () => {
  let contract: IoTLoggerMock;
  beforeEach(() => {
    contract = new IoTLoggerMock();
    contract.reset();
  });
  it("sets oracle contract successfully", () => {
    contract.caller = contract.state.admin;
    const result = contract.setOracleContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.oracleContract).toBe("ST2TEST");
  });
  it("rejects setting oracle contract without admin", () => {
    const result = contract.setOracleContract("ST2TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED_ADMIN);
  });
  it("adds oracle successfully", () => {
    contract.caller = contract.state.admin;
    const result = contract.addOracle("ST3ORACLE");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const oracle = contract.state.oracles.get(0);
    expect(oracle?.principal).toBe("ST3ORACLE");
    expect(oracle?.active).toBe(true);
  });
  it("deactivates oracle successfully", () => {
    contract.caller = contract.state.admin;
    contract.addOracle("ST3ORACLE");
    const result = contract.deactivateOracle(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const oracle = contract.state.oracles.get(0);
    expect(oracle?.active).toBe(false);
  });
  it("logs application successfully", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    const result = contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ farmId: 1, timestamp: 100 });
    const log = contract.getLog(1, 100);
    expect(log?.pesticideType).toBe("glyphosate");
    expect(log?.amountKg).toBe(50);
    expect(log?.verified).toBe(true);
    const count = contract.getFarmLogCount(1).value;
    expect(count).toBe(1);
  });
  it("rejects log without oracle", () => {
    const result = contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_NOT_SET);
  });
  it("rejects log by non-oracle", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.caller = "ST2FAKE";
    const result = contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_ORACLE);
  });
  it("rejects invalid pesticide type", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    const result = contract.logApplication(1, "invalid", 50, 100, '0'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PESTICIDE_TYPE);
  });
  it("rejects invalid amount", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    const result = contract.logApplication(1, "glyphosate", 0, 100, '0'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });
  it("rejects past timestamp", () => {
    contract.blockHeight = 200;
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    const result = contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAST_TIMESTAMP);
  });
  it("rejects invalid sensor hash length", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    const result = contract.logApplication(1, "glyphosate", 50, 100, "short");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SENSOR_HASH);
  });
  it("rejects log limit exceeded", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    contract.state.maxLogsPerFarm = 0;
    const result = contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_LOGS_PER_FARM);
  });
  it("rejects duplicate log", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    const result = contract.logApplication(1, "glyphosate", 60, 100, '1'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LOG_ALREADY_EXISTS);
  });
  it("batch logs successfully", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    const batch = [
      { farmId: 1, pesticideType: "glyphosate", amountKg: 50, timestamp: 100, sensorHash: '0'.repeat(64) },
      { farmId: 1, pesticideType: "atrazine", amountKg: 30, timestamp: 101, sensorHash: '1'.repeat(64) },
    ];
    const result = contract.batchLogApplications(batch);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
    expect(contract.getFarmLogCount(1).value).toBe(2);
  });
  it("rejects empty batch", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    const result = contract.batchLogApplications([]);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BATCH_EMPTY);
  });
  it("rejects batch overflow", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    contract.state.maxBatchSize = 1;
    const batch = [
      { farmId: 1, pesticideType: "glyphosate", amountKg: 50, timestamp: 100, sensorHash: '0'.repeat(64) },
      { farmId: 2, pesticideType: "atrazine", amountKg: 30, timestamp: 101, sensorHash: '1'.repeat(64) }
    ];
    const result = contract.batchLogApplications(batch);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BATCH_OVERFLOW);
  });
  it("gets logs for farm correctly", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    contract.logApplication(1, "atrazine", 30, 150, '1'.repeat(64));
    contract.logApplication(2, "chlorpyrifos", 40, 120, '2'.repeat(64));
    const logs = contract.getLogsForFarm(1, 90, 160);
    expect(logs.length).toBe(2);
    expect(logs[0]).toEqual({ farmId: 1, timestamp: 100 });
    expect(logs[1]).toEqual({ farmId: 1, timestamp: 150 });
  });
  it("gets total pesticide for period correctly", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    contract.logApplication(1, "atrazine", 30, 150, '1'.repeat(64));
    const total = contract.getTotalPesticideForPeriod(1, 90, 160);
    expect(total).toBe(80);
  });
  it("verifies log successfully", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    contract.caller = contract.state.admin;
    const result = contract.verifyLog(1, 100, false);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const log = contract.getLog(1, 100);
    expect(log?.verified).toBe(false);
  });
  it("rejects verify without admin", () => {
    contract.caller = contract.state.admin;
    contract.setOracleContract("ST2TEST");
    contract.addOracle("ST3ORACLE");
    contract.caller = "ST3ORACLE";
    contract.logApplication(1, "glyphosate", 50, 100, '0'.repeat(64));
    const result = contract.verifyLog(1, 100, false);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED_ADMIN);
  });
  it("parses ascii string with Clarity", () => {
    const cv = stringAsciiCV("glyphosate");
    expect(cv.value).toBe("glyphosate");
  });
  it("parses uint with Clarity", () => {
    const cv = uintCV(50);
    expect(cv.value).toEqual(BigInt(50));
  });
});