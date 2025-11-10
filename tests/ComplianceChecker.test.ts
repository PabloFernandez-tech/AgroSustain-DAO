import { describe, it, expect, beforeEach } from "vitest";
import { uintCV, boolCV, listCV, tupleCV } from "@stacks/transactions";
const ERR_INVALID_FARM_ID = 300;
const ERR_INVALID_PERIOD = 301;
const ERR_INVALID_TIMESTAMP = 302;
const ERR_LOG_NOT_FOUND = 303;
const ERR_RULES_NOT_LOADED = 304;
const ERR_COMPLIANCE_ALREADY_COMPUTED = 305;
const ERR_INVALID_SCORE_THRESHOLD = 306;
const ERR_INVALID_VIOLATION_PENALTY = 307;
const ERR_INVALID_LOG_AMOUNT = 308;
const ERR_FARM_NOT_REGISTERED = 309;
const ERR_PERIOD_OVERLAP = 310;
const ERR_INVALID_START_END = 311;
const ERR_UNAUTHORIZED_ADMIN = 312;
const ERR_INVALID_WEIGHT = 313;
interface ComplianceScore {
    compliant: boolean;
    score: number;
    violations: number;
    totalApplied: number;
    computedAt: number;
}
interface HistoricalScore {
    compliant: boolean;
    score: number;
    violations: number;
    totalApplied: number;
    computedAt: number;
}
interface FarmWeights {
    pesticideWeight: number;
    fertilizerWeight: number;
}
interface Rules {
    maxPesticideKg: number;
    maxFertilizerKg: number;
}
interface LogEntry {
    type: string;
    amount: number;
    timestamp: number;
}
interface CheckResult {
    compliant: boolean;
    score: number;
}
interface HistoryResult {
    scores: Array<{ period: number; score: number }>;
    violationsTotal: number;
}
type Result<T> = { ok: boolean; value: T } | { ok: false; value: number };
class ComplianceCheckerMock {
    state: {
        scoreThreshold: number;
        violationPenalty: number;
        admin: string;
        rulesLoaded: boolean;
        complianceScores: Map<string, ComplianceScore>;
        historicalScores: Map<string, HistoricalScore>;
        farmWeights: Map<number, FarmWeights>;
        rules: Rules | null;
    } = {
        scoreThreshold: 80,
        violationPenalty: 20,
        admin: "ST1TEST",
        rulesLoaded: false,
        complianceScores: new Map(),
        historicalScores: new Map(),
        farmWeights: new Map(),
        rules: null,
    };
    blockHeight: number = 0;
    caller: string = "ST1TEST";
    constructor() {
        this.reset();
    }
    reset() {
        this.state = {
            scoreThreshold: 80,
            violationPenalty: 20,
            admin: "ST1TEST",
            rulesLoaded: false,
            complianceScores: new Map(),
            historicalScores: new Map(),
            farmWeights: new Map(),
            rules: null,
        };
        this.blockHeight = 0;
        this.caller = "ST1TEST";
    }
    getCurrentRules(): Result<Rules> {
        if (!this.state.rules) {
            return { ok: false, value: ERR_RULES_NOT_LOADED };
        }
        return { ok: true, value: this.state.rules };
    }
    getFarmLogs(farmId: number, start: number, end: number): Result<LogEntry[]> {
        if (farmId === 0) {
            return { ok: false, value: ERR_FARM_NOT_REGISTERED };
        }
        return { ok: true, value: [
            { type: "pesticide", amount: 50, timestamp: start + 100 },
            { type: "fertilizer", amount: 100, timestamp: start + 200 }
        ]};
    }
    loadRules(): Result<Rules> {
        if (this.state.rulesLoaded) {
            return { ok: true, value: this.state.rules! };
        }
        this.state.rules = { maxPesticideKg: 100, maxFertilizerKg: 200 };
        this.state.rulesLoaded = true;
        return { ok: true, value: this.state.rules };
    }
    validateFarmId(id: number): Result<boolean> {
        return id > 0 ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_FARM_ID };
    }
    validatePeriod(period: number): Result<boolean> {
        return period > 0 ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_PERIOD };
    }
    validateTimestamp(ts: number): Result<boolean> {
        return ts >= 0 ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_TIMESTAMP };
    }
    validateStartEnd(start: number, end: number): Result<boolean> {
        return end > start ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_START_END };
    }
    validateLogAmount(amount: number): Result<boolean> {
        return amount <= 1000000 ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_LOG_AMOUNT };
    }
    validateScoreThreshold(threshold: number): Result<boolean> {
        return (threshold >= 50 && threshold <= 100) ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_SCORE_THRESHOLD };
    }
    validateViolationPenalty(penalty: number): Result<boolean> {
        return penalty <= 50 ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_VIOLATION_PENALTY };
    }
    validateAdmin(caller: string): Result<boolean> {
        return caller === this.state.admin ? { ok: true, value: true } : { ok: false, value: ERR_UNAUTHORIZED_ADMIN };
    }
    validateWeight(weight: number): Result<boolean> {
        return (weight >= 1 && weight <= 100) ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_WEIGHT };
    }
    sumPesticideFromLogs(logs: LogEntry[]): number {
        return logs.reduce((acc, log) => log.type === "pesticide" ? acc + log.amount : acc, 0);
    }
    sumFertilizerFromLogs(logs: LogEntry[]): number {
        return logs.reduce((acc, log) => log.type === "fertilizer" ? acc + log.amount : acc, 0);
    }
    calculateViolations(totalPest: number, maxPest: number, totalFert: number, maxFert: number): number {
        return (totalPest > maxPest ? 1 : 0) + (totalFert > maxFert ? 1 : 0);
    }
    calculateScore(violations: number, totalApplied: number, weights: FarmWeights): number {
        const baseScore = 100;
        const violationDeduct = violations * this.state.violationPenalty;
        const usageFactor = Math.floor((totalApplied * 10) / 10000);
        return Math.max(0, baseScore - (violationDeduct + usageFactor));
    }
    isPeriodOverlap(period: number, start: number, end: number): boolean {
        const periodStart = period * 2592000;
        const periodEnd = periodStart + 2592000;
        return (start >= periodStart && start <= periodEnd) || (end >= periodStart && end <= periodEnd);
    }
    checkCompliance(farmId: number, startTime: number, endTime: number): Result<CheckResult> {
        if (this.validateFarmId(farmId).ok !== true) return { ok: false, value: ERR_INVALID_FARM_ID };
        if (this.validateTimestamp(startTime).ok !== true) return { ok: false, value: ERR_INVALID_TIMESTAMP };
        if (this.validateTimestamp(endTime).ok !== true) return { ok: false, value: ERR_INVALID_TIMESTAMP };
        if (this.validateStartEnd(startTime, endTime).ok !== true) return { ok: false, value: ERR_INVALID_START_END };
        if (!this.state.rulesLoaded) return { ok: false, value: ERR_RULES_NOT_LOADED };
        const rulesResult = this.loadRules();
        if (rulesResult.ok !== true) return { ok: false, value: rulesResult.value };
        const rules = rulesResult.value;
        const logsResult = this.getFarmLogs(farmId, startTime, endTime);
        if (logsResult.ok !== true) return { ok: false, value: logsResult.value };
        const logs = logsResult.value;
        const totalPest = this.sumPesticideFromLogs(logs);
        const totalFert = this.sumFertilizerFromLogs(logs);
        const totalApplied = totalPest + totalFert;
        const violations = this.calculateViolations(totalPest, rules.maxPesticideKg, totalFert, rules.maxFertilizerKg);
        let weights: FarmWeights = { pesticideWeight: 50, fertilizerWeight: 50 };
        const weightsKey = `${farmId}`;
        if (this.state.farmWeights.has(farmId)) {
            weights = this.state.farmWeights.get(farmId)!;
        }
        const score = this.calculateScore(violations, totalApplied, weights);
        const compliant = score >= this.state.scoreThreshold;
        const period = Math.floor(startTime / 2592000);
        const scoreKey = `${farmId}-${period}`;
        if (this.state.complianceScores.has(scoreKey)) {
            return { ok: false, value: ERR_COMPLIANCE_ALREADY_COMPUTED };
        }
        const scoreEntry: ComplianceScore = {
            compliant,
            score,
            violations,
            totalApplied,
            computedAt: this.blockHeight,
        };
        this.state.complianceScores.set(scoreKey, scoreEntry);
        return { ok: true, value: { compliant, score } };
    }
    setScoreThreshold(newThreshold: number): Result<boolean> {
        if (this.validateAdmin(this.caller).ok !== true) return { ok: false, value: ERR_UNAUTHORIZED_ADMIN };
        if (this.validateScoreThreshold(newThreshold).ok !== true) return { ok: false, value: ERR_INVALID_SCORE_THRESHOLD };
        this.state.scoreThreshold = newThreshold;
        return { ok: true, value: true };
    }
    setViolationPenalty(newPenalty: number): Result<boolean> {
        if (this.validateAdmin(this.caller).ok !== true) return { ok: false, value: ERR_UNAUTHORIZED_ADMIN };
        if (this.validateViolationPenalty(newPenalty).ok !== true) return { ok: false, value: ERR_INVALID_VIOLATION_PENALTY };
        this.state.violationPenalty = newPenalty;
        return { ok: true, value: true };
    }
    setFarmWeights(farmId: number, pestWeight: number, fertWeight: number): Result<boolean> {
        if (this.validateFarmId(farmId).ok !== true) return { ok: false, value: ERR_INVALID_FARM_ID };
        if (this.validateWeight(pestWeight).ok !== true) return { ok: false, value: ERR_INVALID_WEIGHT };
        if (this.validateWeight(fertWeight).ok !== true) return { ok: false, value: ERR_INVALID_WEIGHT };
        this.state.farmWeights.set(farmId, { pesticideWeight: pestWeight, fertilizerWeight: fertWeight });
        return { ok: true, value: true };
    }
    archiveScore(farmId: number, period: number, version: number): Result<boolean> {
        const scoreKey = `${farmId}-${period}`;
        const score = this.state.complianceScores.get(scoreKey);
        if (!score) return { ok: false, value: ERR_INVALID_PERIOD };
        const histKey = `${farmId}-${period}-${version}`;
        this.state.historicalScores.set(histKey, score);
        this.state.complianceScores.delete(scoreKey);
        return { ok: true, value: true };
    }
    getComplianceHistory(farmId: number, periods: number[]): Result<HistoryResult> {
        const scores: Array<{ period: number; score: number }> = [];
        let violationsTotal = 0;
        periods.forEach(period => {
            const scoreKey = `${farmId}-${period}`;
            const score = this.state.complianceScores.get(scoreKey);
            if (score) {
                scores.push({ period, score: score.score });
                violationsTotal += score.violations;
            }
        });
        return { ok: true, value: { scores, violationsTotal } };
    }
    getComplianceScore(farmId: number, period: number): ComplianceScore | null {
        const key = `${farmId}-${period}`;
        return this.state.complianceScores.get(key) || null;
    }
    getHistoricalScore(farmId: number, period: number, version: number): HistoricalScore | null {
        const key = `${farmId}-${period}-${version}`;
        return this.state.historicalScores.get(key) || null;
    }
    getFarmWeights(farmId: number): FarmWeights | null {
        return this.state.farmWeights.get(farmId) || null;
    }
}
describe("ComplianceChecker", () => {
    let contract: ComplianceCheckerMock;
    beforeEach(() => {
        contract = new ComplianceCheckerMock();
        contract.reset();
        contract.state.rulesLoaded = true;
        contract.state.rules = { maxPesticideKg: 100, maxFertilizerKg: 200 };
    });
    it("checks compliance successfully", () => {
        const result = contract.checkCompliance(1, 1000, 2000);
        expect(result.ok).toBe(true);
        expect(result.value).toBeDefined();
        const { compliant, score } = result.value;
        expect(compliant).toBe(true);
        expect(score).toBeGreaterThan(0);
        const stored = contract.getComplianceScore(1, 0);
        expect(stored).toBeDefined();
        expect(stored!.compliant).toBe(true);
        expect(stored!.score).toEqual(score);
    });
    it("rejects invalid farm ID", () => {
        const result = contract.checkCompliance(0, 1000, 2000);
        expect(result.ok).toBe(false);
        expect(result.value).toBe(ERR_INVALID_FARM_ID);
    });
    it("rejects invalid start-end timestamps", () => {
        const result = contract.checkCompliance(1, 2000, 1000);
        expect(result.ok).toBe(false);
        expect(result.value).toBe(ERR_INVALID_START_END);
    });
    it("rejects compliance already computed", () => {
        contract.checkCompliance(1, 1000, 2000);
        const result = contract.checkCompliance(1, 1000, 2000);
        expect(result.ok).toBe(false);
        expect(result.value).toBe(ERR_COMPLIANCE_ALREADY_COMPUTED);
    });
    it("sets score threshold successfully", () => {
        const result = contract.setScoreThreshold(90);
        expect(result.ok).toBe(true);
        expect(result.value).toBe(true);
        expect(contract.state.scoreThreshold).toBe(90);
    });
    it("sets violation penalty successfully", () => {
        const result = contract.setViolationPenalty(30);
        expect(result.ok).toBe(true);
        expect(result.value).toBe(true);
        expect(contract.state.violationPenalty).toBe(30);
    });
    it("rejects unauthorized admin for penalty set", () => {
        contract.caller = "ST2FAKE";
        const result = contract.setViolationPenalty(10);
        expect(result.ok).toBe(false);
        expect(result.value).toBe(ERR_UNAUTHORIZED_ADMIN);
    });
    it("sets farm weights successfully", () => {
        const result = contract.setFarmWeights(1, 60, 40);
        expect(result.ok).toBe(true);
        expect(result.value).toBe(true);
        const weights = contract.getFarmWeights(1);
        expect(weights).toEqual({ pesticideWeight: 60, fertilizerWeight: 40 });
    });
    it("rejects invalid farm weights", () => {
        const result = contract.setFarmWeights(1, 0, 50);
        expect(result.ok).toBe(false);
        expect(result.value).toBe(ERR_INVALID_WEIGHT);
    });
    it("archives score successfully", () => {
        contract.checkCompliance(1, 1000, 2000);
        const result = contract.archiveScore(1, 0, 1);
        expect(result.ok).toBe(true);
        expect(result.value).toBe(true);
        expect(contract.getComplianceScore(1, 0)).toBeNull();
        expect(contract.getHistoricalScore(1, 0, 1)).toBeDefined();
    });
    it("rejects archive for non-existent score", () => {
        const result = contract.archiveScore(1, 999, 1);
        expect(result.ok).toBe(false);
        expect(result.value).toBe(ERR_INVALID_PERIOD);
    });
    it("calculates score with violations", () => {
        contract.state.rules = { maxPesticideKg: 10, maxFertilizerKg: 50 };
        const result = contract.checkCompliance(1, 1000, 2000);
        expect(result.ok).toBe(true);
        expect(result.value.score).toBeLessThan(100);
    });
    it("uses custom weights in score calculation", () => {
        contract.setFarmWeights(1, 70, 30);
        contract.state.rules = { maxPesticideKg: 100, maxFertilizerKg: 200 };
        const result = contract.checkCompliance(1, 1000, 2000);
        expect(result.ok).toBe(true);
        const stored = contract.getComplianceScore(1, 0);
        expect(stored).toBeDefined();
    });
    it("parses uint parameters with Clarity", () => {
        const farmId = uintCV(1);
        const startTime = uintCV(1000);
        const endTime = uintCV(2000);
        expect(farmId.value.toString()).toBe("1");
        expect(startTime.value.toString()).toBe("1000");
        expect(endTime.value.toString()).toBe("2000");
    });
    it("rejects rules not loaded", () => {
        contract.state.rulesLoaded = false;
        const result = contract.checkCompliance(1, 1000, 2000);
        expect(result.ok).toBe(false);
        expect(result.value).toBe(ERR_RULES_NOT_LOADED);
    });
    it("loads rules on demand", () => {
        contract.state.rulesLoaded = false;
        const loadResult = contract.loadRules();
        expect(loadResult.ok).toBe(true);
        expect(loadResult.value).toEqual({ maxPesticideKg: 100, maxFertilizerKg: 200 });
        expect(contract.state.rulesLoaded).toBe(true);
    });
});