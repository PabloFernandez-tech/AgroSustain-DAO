(define-constant ERR-NOT-STAKER (err u200))
(define-constant ERR-VOTING-CLOSED (err u201))
(define-constant ERR-PROPOSAL-NOT-FOUND (err u202))
(define-constant ERR-NOT-EXECUTABLE (err u203))
(define-constant ERR-ALREADY-VOTED (err u204))
(define-constant ERR-INSUFFICIENT-STAKE (err u205))
(define-constant ERR-INVALID-PROPOSAL-DESC (err u206))
(define-constant ERR-INVALID-PERIOD (err u207))
(define-constant ERR-UNSTAKE-LOCKED (err u208))
(define-constant ERR-ADMINS-ONLY (err u209))
(define-constant ERR-INVALID-THRESHOLD (err u210))
(define-constant ERR-MAX-PROPOSALS-EXCEEDED (err u211))

(define-data-var current-rules 
    { 
        max-pesticide-kg: uint, 
        max-fertilizer-kg: uint, 
        review-period: uint 
    } 
    { 
        max-pesticide-kg: u50, 
        max-fertilizer-kg: u200, 
        review-period: u100 
    }
)

(define-data-var voting-delay uint u10)
(define-data-var voting-period uint u100)
(define-data-var proposal-threshold uint u1000)
(define-data-var quorum-percent uint u4)
(define-data-var max-proposals uint u1000)
(define-data-var admins (list 25 principal) (list ))

(define-data-var next-proposal-id uint u0)

(define-map proposals
    { id: uint }
    {
        description: (string-ascii 256),
        rule-change: { 
            max-pesticide: uint, 
            max-fertilizer: uint, 
            review-period: uint 
        },
        yes-votes: uint,
        no-votes: uint,
        start-block: uint,
        end-block: uint,
        executed: bool,
        canceled: bool,
        proposer: principal
    }
)

(define-map stakes 
    { farmer: principal } 
    { 
        staked-agro: uint, 
        locked-until: uint 
    }
)

(define-map votes 
    { proposal: uint, voter: principal } 
    bool
)

(define-map proposal-counts uint uint)

(define-read-only (get-current-rules)
    (var-get current-rules)
)

(define-read-only (get-proposal (id uint))
    (map-get? proposals { id: id })
)

(define-read-only (get-stake (farmer principal))
    (map-get? stakes { farmer: farmer })
)

(define-read-only (get-vote (proposal uint) (voter principal))
    (map-get? votes { proposal: proposal, voter: voter })
)

(define-read-only (get-proposal-count)
    (var-get next-proposal-id)
)

(define-private (validate-description (desc (string-ascii 256)))
    (if (and (> (len desc) u10) (<= (len desc) u256))
        (ok true)
        (err ERR-INVALID-PROPOSAL-DESC))
)

(define-private (validate-rule-change (change { max-pesticide: uint, max-fertilizer: uint, review-period: uint }))
    (and 
        (> (get max-pesticide change) u0) 
        (> (get max-fertilizer change) u0) 
        (> (get review-period change) u0)
    )
)

(define-private (validate-stake (stake uint))
    (if (>= stake (var-get proposal-threshold))
        (ok true)
        (err ERR-INSUFFICIENT-STAKE))
)

(define-private (is-voting-open (proposal { id: uint }))
    (let ((p (unwrap! (map-get? proposals proposal) ERR-PROPOSAL-NOT-FOUND)))
        (and 
            (>= block-height (get start-block p)) 
            (< block-height (get end-block p))
            (not (get executed p))
            (not (get canceled p))
        )
    )
)

(define-private (has-voted (proposal uint) (voter principal))
    (is-some (map-get? votes { proposal: proposal, voter: voter }))
)

(define-private (calculate-quorum (total-staked uint))
    (* total-staked (var-get quorum-percent) u25)
)

(define-private (is-admin (caller principal))
    (is-some (index-of (var-get admins) caller))
)

(define-public (add-admin (new-admin principal))
    (begin
        (asserts! (is-admin tx-sender) ERR-ADMINS-ONLY)
        (let ((current-admins (var-get admins)))
            (var-set admins (unwrap! (as-max-len? (append current-admins new-admin) u25) ERR-ADMINS-ONLY))
        )
        (ok true)
    )
)

(define-public (set-voting-params 
    (delay uint) 
    (period uint) 
    (threshold uint) 
    (quorum uint)
)
    (begin
        (asserts! (is-admin tx-sender) ERR-ADMINS-ONLY)
        (asserts! (and (> delay u0) (> period u0) (> threshold u0) (<= quorum u100)) ERR-INVALID-THRESHOLD)
        (var-set voting-delay delay)
        (var-set voting-period period)
        (var-set proposal-threshold threshold)
        (var-set quorum-percent quorum)
        (ok true)
    )
)

(define-public (stake-agro (amount uint))
    (begin
        (asserts! (> amount u0) ERR-INSUFFICIENT-STAKE)
        (let ((current (map-get? stakes { farmer: tx-sender })))
            (match current
                existing 
                    (let ((new-stake (+ (get staked-agro existing) amount)))
                        (map-set stakes { farmer: tx-sender } 
                            { 
                                staked-agro: new-stake, 
                                locked-until: (+ block-height (var-get voting-period)) 
                            }
                        )
                    )
                (map-insert stakes { farmer: tx-sender } 
                    { 
                        staked-agro: amount, 
                        locked-until: (+ block-height (var-get voting-period)) 
                    }
                )
            )
        )
        (print { event: "agro-staked", farmer: tx-sender, amount: amount })
        (ok amount)
    )
)

(define-public (unstake-agro (amount uint))
    (let (
        (current (unwrap! (map-get? stakes { farmer: tx-sender }) ERR-NOT-STAKER))
        (locked-until (get locked-until current))
    )
        (asserts! (>= block-height locked-until) ERR-UNSTAKE-LOCKED)
        (asserts! (>= (get staked-agro current) amount) ERR-INSUFFICIENT-STAKE)
        (let ((new-stake (- (get staked-agro current) amount)))
            (if (> new-stake u0)
                (map-set stakes { farmer: tx-sender } 
                    { 
                        staked-agro: new-stake, 
                        locked-until: (+ block-height (var-get voting-period)) 
                    }
                )
                (map-delete stakes { farmer: tx-sender })
            )
            (print { event: "agro-unstaked", farmer: tx-sender, amount: amount })
            (ok amount)
        )
    )
)

(define-public (propose-rule
    (description (string-ascii 256))
    (new-pesticide uint)
    (new-fertilizer uint)
    (new-period uint)
)
    (let (
        (next-id (var-get next-proposal-id))
        (change { max-pesticide: new-pesticide, max-fertilizer: new-fertilizer, review-period: new-period })
        (stake (unwrap! (map-get? stakes { farmer: tx-sender }) ERR-NOT-STAKER))
    )
        (asserts! (< next-id (var-get max-proposals)) ERR-MAX-PROPOSALS-EXCEEDED)
        (try! (validate-description description))
        (asserts! (validate-rule-change change) ERR-INVALID-PROPOSAL-DESC)
        (try! (validate-stake (get staked-agro stake)))
        (let (
            (start-block (+ block-height (var-get voting-delay)))
            (end-block (+ start-block (var-get voting-period)))
        )
            (map-insert proposals { id: next-id }
                {
                    description: description,
                    rule-change: change,
                    yes-votes: u0,
                    no-votes: u0,
                    start-block: start-block,
                    end-block: end-block,
                    executed: false,
                    canceled: false,
                    proposer: tx-sender
                }
            )
            (map-insert proposal-counts { proposer: tx-sender } 
                (default-to u0 (+ (default-to u0 (map-get? proposal-counts { proposer: tx-sender })) u1))
            )
            (var-set next-proposal-id (+ next-id u1))
            (print { event: "proposal-created", id: next-id, proposer: tx-sender })
            (ok next-id)
        )
    )
)

(define-public (vote (proposal-id uint) (support bool))
    (let (
        (proposal (unwrap! (map-get? proposals { id: proposal-id }) ERR-PROPOSAL-NOT-FOUND))
        (stake (get staked-agro (unwrap! (map-get? stakes { farmer: tx-sender }) ERR-NOT-STAKER)))
    )
        (asserts! (is-voting-open { id: proposal-id }) ERR-VOTING-CLOSED)
        (asserts! (not (has-voted proposal-id tx-sender)) ERR-ALREADY-VOTED)
        (map-insert votes { proposal: proposal-id, voter: tx-sender } support)
        (if support
            (map-set proposals { id: proposal-id } 
                (merge proposal { yes-votes: (+ (get yes-votes proposal) stake) })
            )
            (map-set proposals { id: proposal-id } 
                (merge proposal { no-votes: (+ (get no-votes proposal) stake) })
            )
        )
        (print { event: "vote-cast", proposal: proposal-id, voter: tx-sender, support: support })
        (ok true)
    )
)

(define-public (execute-proposal (id uint))
    (let (
        (proposal (unwrap! (map-get? proposals { id: id }) ERR-PROPOSAL-NOT-FOUND))
        (yes (get yes-votes proposal))
        (no (get no-votes proposal))
        (change (get rule-change proposal))
    )
        (asserts! (>= block-height (get end-block proposal)) ERR-NOT-EXECUTABLE)
        (asserts! (not (get executed proposal)) ERR-NOT-EXECUTABLE)
        (asserts! (not (get canceled proposal)) ERR-NOT-EXECUTABLE)
        (asserts! (>= yes (calculate-quorum (+ yes no))) ERR-VOTING-CLOSED)
        (asserts! (> yes no) ERR-VOTING-CLOSED)
        (map-set proposals { id: id } (merge proposal { executed: true }))
        (var-set current-rules change)
        (print { event: "proposal-executed", id: id, new-rules: change })
        (ok true)
    )
)

(define-public (cancel-proposal (id uint))
    (begin
        (asserts! (is-eq (get proposer (unwrap! (map-get? proposals { id: id }) ERR-PROPOSAL-NOT-FOUND)) tx-sender) ERR-NOT-AUTHORIZED)
        (asserts! (< block-height (get end-block (unwrap! (map-get? proposals { id: id }) ERR-PROPOSAL-NOT-FOUND))) ERR-NOT-EXECUTABLE)
        (map-set proposals { id: id } 
            (merge (unwrap! (map-get? proposals { id: id }) ERR-PROPOSAL-NOT-FOUND) { canceled: true })
        )
        (print { event: "proposal-canceled", id: id })
        (ok true)
    )
)