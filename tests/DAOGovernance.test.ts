import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV, principalCV, boolCV } from "@stacks/transactions";

const ERR_NOT_STAKER = 200;
const ERR_VOTING_CLOSED = 201;
const ERR_PROPOSAL_NOT_FOUND = 202;
const ERR_NOT_EXECUTABLE = 203;
const ERR_ALREADY_VOTED = 204;
const ERR_INSUFFICIENT_STAKE = 205;
const ERR_INVALID_PROPOSAL_DESC = 206;
const ERR_UNSTAKE_LOCKED = 208;
const ERR_ADMINS_ONLY = 209;
const ERR_INVALID_THRESHOLD = 210;
const ERR_MAX_PROPOSALS_EXCEEDED = 211;

interface Rules {
  maxPesticideKg: number;
  maxFertilizerKg: number;
  reviewPeriod: number;
}

interface Proposal {
  description: string;
  ruleChange: Rules;
  yesVotes: number;
  noVotes: number;
  startBlock: number;
  endBlock: number;
  executed: boolean;
  canceled: boolean;
  proposer: string;
}

interface Stake {
  stakedAgro: number;
  lockedUntil: number;
}

interface Vote {
  support: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class DAOGovernanceMock {
  state: {
    currentRules: Rules;
    votingDelay: number;
    votingPeriod: number;
    proposalThreshold: number;
    quorumPercent: number;
    maxProposals: number;
    admins: string[];
    nextProposalId: number;
    proposals: Map<number, Proposal>;
    stakes: Map<string, Stake>;
    votes: Map<string, boolean>;
    proposalCounts: Map<string, number>;
  } = {
    currentRules: { maxPesticideKg: 50, maxFertilizerKg: 200, reviewPeriod: 100 },
    votingDelay: 10,
    votingPeriod: 100,
    proposalThreshold: 1000,
    quorumPercent: 4,
    maxProposals: 1000,
    admins: [],
    nextProposalId: 0,
    proposals: new Map(),
    stakes: new Map(),
    votes: new Map(),
    proposalCounts: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      currentRules: { maxPesticideKg: 50, maxFertilizerKg: 200, reviewPeriod: 100 },
      votingDelay: 10,
      votingPeriod: 100,
      proposalThreshold: 1000,
      quorumPercent: 4,
      maxProposals: 1000,
      admins: [],
      nextProposalId: 0,
      proposals: new Map(),
      stakes: new Map(),
      votes: new Map(),
      proposalCounts: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
  }

  getCurrentRules(): Rules {
    return this.state.currentRules;
  }

  getProposal(id: number): Proposal | null {
    return this.state.proposals.get(id) || null;
  }

  getStake(farmer: string): Stake | null {
    return this.state.stakes.get(farmer) || null;
  }

  getVote(proposal: number, voter: string): boolean | null {
    const key = `${proposal}-${voter}`;
    return this.state.votes.get(key) || null;
  }

  getProposalCount(): number {
    return this.state.nextProposalId;
  }

  isAdmin(caller: string): boolean {
    return this.state.admins.includes(caller);
  }

  addAdmin(newAdmin: string): Result<boolean> {
    if (!this.isAdmin(this.caller)) return { ok: false, value: false };
    if (this.state.admins.length >= 25) return { ok: false, value: false };
    this.state.admins.push(newAdmin);
    return { ok: true, value: true };
  }

  setVotingParams(delay: number, period: number, threshold: number, quorum: number): Result<boolean> {
    if (!this.isAdmin(this.caller)) return { ok: false, value: false };
    if (delay <= 0 || period <= 0 || threshold <= 0 || quorum > 100) return { ok: false, value: ERR_INVALID_THRESHOLD };
    this.state.votingDelay = delay;
    this.state.votingPeriod = period;
    this.state.proposalThreshold = threshold;
    this.state.quorumPercent = quorum;
    return { ok: true, value: true };
  }

  stakeAgro(amount: number): Result<number> {
    if (amount <= 0) return { ok: false, value: 0 };
    const current = this.getStake(this.caller);
    const newStake = (current ? current.stakedAgro : 0) + amount;
    const lockedUntil = this.blockHeight + this.state.votingPeriod;
    this.state.stakes.set(this.caller, { stakedAgro: newStake, lockedUntil });
    return { ok: true, value: amount };
  }

  unstakeAgro(amount: number): Result<number> {
    const current = this.getStake(this.caller);
    if (!current) return { ok: false, value: ERR_NOT_STAKER };
    if (this.blockHeight < current.lockedUntil) return { ok: false, value: ERR_UNSTAKE_LOCKED };
    if (current.stakedAgro < amount) return { ok: false, value: ERR_INSUFFICIENT_STAKE };
    const newStake = current.stakedAgro - amount;
    if (newStake > 0) {
      this.state.stakes.set(this.caller, { stakedAgro: newStake, lockedUntil: this.blockHeight + this.state.votingPeriod });
    } else {
      this.state.stakes.delete(this.caller);
    }
    return { ok: true, value: amount };
  }

  proposeRule(
    description: string,
    newPesticide: number,
    newFertilizer: number,
    newPeriod: number
  ): Result<number> {
    if (this.state.nextProposalId >= this.state.maxProposals) return { ok: false, value: ERR_MAX_PROPOSALS_EXCEEDED };
    if (description.length < 10 || description.length > 256) return { ok: false, value: ERR_INVALID_PROPOSAL_DESC };
    if (newPesticide <= 0 || newFertilizer <= 0 || newPeriod <= 0) return { ok: false, value: ERR_INVALID_PROPOSAL_DESC };
    const stake = this.getStake(this.caller);
    if (!stake || stake.stakedAgro < this.state.proposalThreshold) return { ok: false, value: ERR_INSUFFICIENT_STAKE };
    const startBlock = this.blockHeight + this.state.votingDelay;
    const endBlock = startBlock + this.state.votingPeriod;
    const id = this.state.nextProposalId;
    const proposal: Proposal = {
      description,
      ruleChange: { maxPesticideKg: newPesticide, maxFertilizerKg: newFertilizer, reviewPeriod: newPeriod },
      yesVotes: 0,
      noVotes: 0,
      startBlock,
      endBlock,
      executed: false,
      canceled: false,
      proposer: this.caller,
    };
    this.state.proposals.set(id, proposal);
    const currentCount = this.state.proposalCounts.get(this.caller) || 0;
    this.state.proposalCounts.set(this.caller, currentCount + 1);
    this.state.nextProposalId++;
    return { ok: true, value: id };
  }

  vote(proposalId: number, support: boolean): Result<boolean> {
    const proposal = this.getProposal(proposalId);
    if (!proposal) return { ok: false, value: false };
    if (this.blockHeight < proposal.startBlock || this.blockHeight >= proposal.endBlock || proposal.executed || proposal.canceled) {
      return { ok: false, value: ERR_VOTING_CLOSED };
    }
    const key = `${proposalId}-${this.caller}`;
    if (this.state.votes.has(key)) return { ok: false, value: ERR_ALREADY_VOTED };
    const stake = this.getStake(this.caller);
    if (!stake) return { ok: false, value: ERR_NOT_STAKER };
    this.state.votes.set(key, support);
    if (support) {
      this.state.proposals.set(proposalId, { ...proposal, yesVotes: proposal.yesVotes + stake.stakedAgro });
    } else {
      this.state.proposals.set(proposalId, { ...proposal, noVotes: proposal.noVotes + stake.stakedAgro });
    }
    return { ok: true, value: true };
  }

  executeProposal(id: number): Result<boolean> {
    const proposal = this.getProposal(id);
    if (!proposal) return { ok: false, value: false };
    if (this.blockHeight < proposal.endBlock || proposal.executed || proposal.canceled) return { ok: false, value: ERR_NOT_EXECUTABLE };
    const totalVotes = proposal.yesVotes + proposal.noVotes;
    const quorum = (totalVotes * this.state.quorumPercent) / 25;
    if (proposal.yesVotes < quorum || proposal.yesVotes <= proposal.noVotes) return { ok: false, value: ERR_VOTING_CLOSED };
    this.state.proposals.set(id, { ...proposal, executed: true });
    this.state.currentRules = proposal.ruleChange;
    return { ok: true, value: true };
  }

  cancelProposal(id: number): Result<boolean> {
    const proposal = this.getProposal(id);
    if (!proposal) return { ok: false, value: false };
    if (proposal.proposer !== this.caller || this.blockHeight >= proposal.endBlock) return { ok: false, value: ERR_NOT_EXECUTABLE };
    this.state.proposals.set(id, { ...proposal, canceled: true });
    return { ok: true, value: true };
  }

  advanceBlock(blocks: number) {
    this.blockHeight += blocks;
  }
}

describe("DAOGovernance", () => {
  let contract: DAOGovernanceMock;

  beforeEach(() => {
    contract = new DAOGovernanceMock();
    contract.reset();
    contract.state.admins = ["ST1TEST"];
  });

  it("sets voting parameters successfully", () => {
    const result = contract.setVotingParams(5, 50, 500, 5);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.votingDelay).toBe(5);
    expect(contract.state.votingPeriod).toBe(50);
    expect(contract.state.proposalThreshold).toBe(500);
    expect(contract.state.quorumPercent).toBe(5);
  });

  it("rejects voting params without admin", () => {
    contract.caller = "ST2NONADMIN";
    const result = contract.setVotingParams(5, 50, 500, 5);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid voting threshold", () => {
    const result = contract.setVotingParams(5, 50, 0, 5);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_THRESHOLD);
  });

  it("stakes AGRO successfully", () => {
    const result = contract.stakeAgro(2000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2000);
    const stake = contract.getStake("ST1TEST");
    expect(stake?.stakedAgro).toBe(2000);
    expect(stake?.lockedUntil).toBe(100);
  });

  it("unstakes AGRO after lock period", () => {
    contract.stakeAgro(2000);
    contract.advanceBlock(101);
    const result = contract.unstakeAgro(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
    const stake = contract.getStake("ST1TEST");
    expect(stake?.stakedAgro).toBe(1000);
  });

  it("rejects unstake during lock", () => {
    contract.stakeAgro(2000);
    const result = contract.unstakeAgro(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNSTAKE_LOCKED);
  });

  it("proposes rule successfully", () => {
    contract.stakeAgro(2000);
    const result = contract.proposeRule("Reduce pesticide limit", 40, 150, 80);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const proposal = contract.getProposal(0);
    expect(proposal?.description).toBe("Reduce pesticide limit");
    expect(proposal?.ruleChange.maxPesticideKg).toBe(40);
    expect(proposal?.startBlock).toBe(10);
    expect(proposal?.endBlock).toBe(110);
  });

  it("rejects proposal without sufficient stake", () => {
    const result = contract.proposeRule("This is a valid long description", 40, 150, 80);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_STAKE);
  });

  it("rejects proposal with invalid description", () => {
    contract.stakeAgro(2000);
    const result = contract.proposeRule("Short", 40, 150, 80);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROPOSAL_DESC);
  });

  it("rejects proposal with invalid rule change", () => {
    contract.stakeAgro(2000);
    const result = contract.proposeRule("Valid desc but invalid rule", 0, 150, 80);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROPOSAL_DESC);
  });

  it("votes yes successfully", () => {
    contract.stakeAgro(2000);
    contract.proposeRule("Test proposal", 40, 150, 80);
    contract.advanceBlock(11);
    const result = contract.vote(0, true);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const vote = contract.getVote(0, "ST1TEST");
    expect(vote).toBe(true);
    const proposal = contract.getProposal(0);
    expect(proposal?.yesVotes).toBe(2000);
  });

  it("rejects vote before start", () => {
    contract.stakeAgro(2000);
    contract.proposeRule("Valid proposal description", 40, 150, 80);
    const result = contract.vote(0, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_VOTING_CLOSED);
  });

  it("rejects duplicate vote", () => {
    contract.stakeAgro(2000);
    contract.proposeRule("Valid proposal description", 40, 150, 80);
    contract.advanceBlock(11);
    contract.vote(0, true);
    const result = contract.vote(0, false);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_VOTED);
  });

  it("executes proposal successfully", () => {
    contract.stakeAgro(2000);
    contract.proposeRule("Valid proposal for execution", 40, 150, 80);
    contract.advanceBlock(11);
    contract.vote(0, true);
    contract.advanceBlock(100);
    const result = contract.executeProposal(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getCurrentRules().maxPesticideKg).toBe(40);
    const proposal = contract.getProposal(0);
    expect(proposal?.executed).toBe(true);
  });

  it("rejects execution before end", () => {
    contract.stakeAgro(2000);
    contract.proposeRule("Valid proposal for early execution", 40, 150, 80);
    contract.advanceBlock(50);
    contract.vote(0, true);
    const result = contract.executeProposal(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_EXECUTABLE);
  });

  it("rejects execution if quorum not met", () => {
    contract.stakeAgro(2000);
    contract.proposeRule("Valid proposal for quorum test", 40, 150, 80);
    contract.advanceBlock(11);
    contract.vote(0, false);
    contract.advanceBlock(100);
    const result = contract.executeProposal(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_VOTING_CLOSED);
  });

  it("cancels proposal successfully", () => {
    contract.stakeAgro(2000);
    contract.proposeRule("Valid proposal to cancel", 40, 150, 80);
    const result = contract.cancelProposal(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const proposal = contract.getProposal(0);
    expect(proposal?.canceled).toBe(true);
  });

  it("rejects cancel after end", () => {
    contract.stakeAgro(2000);
    contract.proposeRule("Valid proposal to cancel late", 40, 150, 80);
    contract.advanceBlock(111);
    const result = contract.cancelProposal(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_EXECUTABLE);
  });

  it("rejects proposal when max exceeded", () => {
    contract.state.maxProposals = 0;
    contract.stakeAgro(2000);
    const result = contract.proposeRule("Valid proposal description", 40, 150, 80);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_PROPOSALS_EXCEEDED);
  });

  it("parses Clarity types correctly", () => {
    const desc = stringAsciiCV("Test description");
    const pesticide = uintCV(40n);
    const fertilizer = uintCV(150n);
    const period = uintCV(80n);
    expect(desc.value).toBe("Test description");
    expect(pesticide.value).toBe(40n);
    expect(fertilizer.value).toBe(150n);
    expect(period.value).toBe(80n);
  });

  it("adds admin successfully", () => {
    const result = contract.addAdmin("ST2TEST");
    expect(result.ok).toBe(true);
    expect(contract.isAdmin("ST2TEST")).toBe(true);
  });

  it("rejects add admin without authority", () => {
    contract.caller = "ST2NONADMIN";
    const result = contract.addAdmin("ST3TEST");
    expect(result.ok).toBe(false);
  });
});