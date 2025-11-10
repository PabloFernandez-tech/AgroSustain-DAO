(define-constant ERR-INVALID-FARM-ID u300)
(define-constant ERR-INVALID-PERIOD u301)
(define-constant ERR-INVALID-TIMESTAMP u302)
(define-constant ERR-LOG-NOT-FOUND u303)
(define-constant ERR-RULES-NOT-LOADED u304)
(define-constant ERR-COMPLIANCE-ALREADY-COMPUTED u305)
(define-constant ERR-INVALID-SCORE-THRESHOLD u306)
(define-constant ERR-INVALID-VIOLATION-PENALTY u307)
(define-constant ERR-INVALID-LOG-AMOUNT u308)
(define-constant ERR-FARM-NOT-REGISTERED u309)
(define-constant ERR-PERIOD-OVERLAP u310)
(define-constant ERR-INVALID-START-END u311)
(define-constant ERR-UNAUTHORIZED-ADMIN u312)
(define-constant ERR-INVALID-WEIGHT u313)
(define-data-var score-threshold uint u80)
(define-data-var violation-penalty uint u20)
(define-data-var admin principal tx-sender)
(define-data-var rules-loaded bool false)
(define-map compliance-scores
    { farm-id: uint, period: uint }
    {
        compliant: bool,
        score: uint,
        violations: uint,
        total-applied: uint,
        computed-at: uint
    }
)
(define-map historical-scores
    { farm-id: uint, period: uint, version: uint }
    {
        compliant: bool,
        score: uint,
        violations: uint,
        total-applied: uint,
        computed-at: uint
    }
)
(define-map farm-rule-weights
    { farm-id: uint }
    {
        pesticide-weight: uint,
        fertilizer-weight: uint
    }
)
(define-read-only (get-compliance-score (farm-id uint) (period uint))
    (map-get? compliance-scores { farm-id: farm-id, period: period })
)
(define-read-only (get-historical-score (farm-id uint) (period uint) (version uint))
    (map-get? historical-scores { farm-id: farm-id, period: period, version: version })
)
(define-read-only (get-farm-weights (farm-id uint))
    (map-get? farm-rule-weights { farm-id: farm-id })
)
(define-read-only (get-current-rules)
    (contract-call? .DAOGovernance get-current-rules)
)
(define-read-only (get-farm-logs (farm-id uint) (start uint) (end uint))
    (contract-call? .IoTLogger get-logs-for-period farm-id start end)
)
(define-private (validate-farm-id (id uint))
    (if (> id u0)
        (ok true)
        (err ERR-INVALID-FARM-ID))
)
(define-private (validate-period (period uint))
    (if (> period u0)
        (ok true)
        (err ERR-INVALID-PERIOD))
)
(define-private (validate-timestamp (ts uint))
    (if (>= ts u0)
        (ok true)
        (err ERR-INVALID-TIMESTAMP))
)
(define-private (validate-start-end (start uint) (end uint))
    (if (> end start)
        (ok true)
        (err ERR-INVALID-START-END))
)
(define-private (validate-log-amount (amount uint))
    (if (<= amount u1000000)
        (ok true)
        (err ERR-INVALID-LOG-AMOUNT))
)
(define-private (validate-score-threshold (threshold uint))
    (if (and (>= threshold u50) (<= threshold u100))
        (ok true)
        (err ERR-INVALID-SCORE-THRESHOLD))
)
(define-private (validate-violation-penalty (penalty uint))
    (if (<= penalty u50)
        (ok true)
        (err ERR-INVALID-VIOLATION-PENALTY))
)
(define-private (validate-admin (caller principal))
    (if (is-eq caller (var-get admin))
        (ok true)
        (err ERR-UNAUTHORIZED-ADMIN))
)
(define-private (validate-weight (weight uint))
    (if (and (>= weight u1) (<= weight u100))
        (ok true)
        (err ERR-INVALID-WEIGHT))
)
(define-private (load-rules)
    (let ((rules-opt (get-current-rules)))
        (match rules-opt
            rules
                (begin
                    (var-set rules-loaded true)
                    (ok rules)
                )
            (err ERR-RULES-NOT-LOADED)
        )
    )
)
(define-private (sum-pesticide-from-logs (logs (list 200 { type: (string-ascii 50), amount: uint, timestamp: uint })))
    (fold
        sum-pesticide-amount
        logs
        u0
    )
)
(define-private (sum-pesticide-amount (acc uint) (log { type: (string-ascii 50), amount: uint, timestamp: uint }))
    (if (is-eq (get type log) "pesticide")
        (+ acc (get amount log))
        acc
    )
)
(define-private (sum-fertilizer-from-logs (logs (list 200 { type: (string-ascii 50), amount: uint, timestamp: uint })))
    (fold
        sum-fertilizer-amount
        logs
        u0
    )
)
(define-private (sum-fertilizer-amount (acc uint) (log { type: (string-ascii 50), amount: uint, timestamp: uint }))
    (if (is-eq (get type log) "fertilizer")
        (+ acc (get amount log))
        acc
    )
)
(define-private (calculate-violations (total-pest uint) (max-pest uint) (total-fert uint) (max-fert uint))
    (+
        (if (> total-pest max-pest)
            u1
            u0
        )
        (if (> total-fert max-fert)
            u1
            u0
        )
    )
)
(define-private (calculate-score (violations uint) (total-applied uint) (weights { pesticide-weight: uint, fertilizer-weight: uint }))
    (let (
            (base-score u100)
            (violation-deduct (* violations (var-get violation-penalty)))
            (usage-factor (/ (* total-applied u10) u10000))
        )
        (max u0 (- base-score (+ violation-deduct usage-factor)))
    )
)
(define-private (is-period-overlap (period uint) (start uint) (end uint))
    (let (
            (period-start (* period u2592000))
            (period-end (+ period-start u2592000))
        )
        (or
            (and (>= start period-start) (<= start period-end))
            (and (>= end period-start) (<= end period-end))
        )
    )
)
(define-public (check-compliance (farm-id uint) (start-time uint) (end-time uint))
    (begin
        (try! (validate-farm-id farm-id))
        (try! (validate-timestamp start-time))
        (try! (validate-timestamp end-time))
        (try! (validate-start-end start-time end-time))
        (asserts! (var-get rules-loaded) (err ERR-RULES-NOT-LOADED))
        (let* (
                (rules (try! (load-rules)))
                (max-pest (get max-pesticide-kg rules))
                (max-fert (get max-fertilizer-kg rules))
                (logs-opt (try! (get-farm-logs farm-id start-time end-time)))
                (logs (unwrap! logs-opt (err ERR-LOG-NOT-FOUND)))
                (total-pest (sum-pesticide-from-logs logs))
                (total-fert (sum-fertilizer-from-logs logs))
                (total-applied (+ total-pest total-fert))
                (violations (calculate-violations total-pest max-pest total-fert max-fert))
                (weights-opt (get-farm-weights farm-id))
                (weights (unwrap! weights-opt { pesticide-weight: u50, fertilizer-weight: u50 }))
                (score (calculate-score violations total-applied weights))
                (compliant (>= score (var-get score-threshold)))
                (period (/ start-time u2592000))
                (existing (map-get? compliance-scores { farm-id: farm-id, period: period }))
            )
            (asserts! (is-none existing) (err ERR-COMPLIANCE-ALREADY-COMPUTED))
            (map-insert compliance-scores { farm-id: farm-id, period: period }
                {
                    compliant: compliant,
                    score: score,
                    violations: violations,
                    total-applied: total-applied,
                    computed-at: block-height
                }
            )
            (print { event: "compliance-checked", farm-id: farm-id, period: period, score: score })
            (ok { compliant: compliant, score: score })
        )
    )
)
(define-public (set-score-threshold (new-threshold uint))
    (begin
        (try! (validate-admin tx-sender))
        (try! (validate-score-threshold new-threshold))
        (var-set score-threshold new-threshold)
        (ok true)
    )
)
(define-public (set-violation-penalty (new-penalty uint))
    (begin
        (try! (validate-admin tx-sender))
        (try! (validate-violation-penalty new-penalty))
        (var-set violation-penalty new-penalty)
        (ok true)
    )
)
(define-public (set-farm-weights (farm-id uint) (pest-weight uint) (fert-weight uint))
    (begin
        (try! (validate-farm-id farm-id))
        (try! (validate-weight pest-weight))
        (try! (validate-weight fert-weight))
        (map-set farm-rule-weights { farm-id: farm-id }
            { pesticide-weight: pest-weight, fertilizer-weight: fert-weight }
        )
        (ok true)
    )
)
(define-public (archive-score (farm-id uint) (period uint) (version uint))
    (let (
            (score-opt (map-get? compliance-scores { farm-id: farm-id, period: period }))
        )
        (match score-opt
            score
                (begin
                    (map-insert historical-scores { farm-id: farm-id, period: period, version: version } score)
                    (map-delete compliance-scores { farm-id: farm-id, period: period })
                    (ok true)
                )
            (err ERR-INVALID-PERIOD)
        )
    )
)
(define-public (get-compliance-history (farm-id uint) (periods (list 10 uint)))
    (fold
        get-period-score
        periods
        { scores: (list ), violations-total: u0 }
    )
)
(define-private (get-period-score (acc { scores: (list 10 { period: uint, score: uint }), violations-total: uint }) (period uint))
    (let (
            (score-opt (get-compliance-score farm-id period))
        )
        (match score-opt
            s
                (let (
                        (new-scores (unwrap! (as-max-len? (append (get scores acc) { period: period, score: (get score s) }) u10) (get scores acc)))
                    )
                    { scores: new-scores, violations-total: (+ (get violations-total acc) (get violations s)) }
                )
            acc
        )
    )
)