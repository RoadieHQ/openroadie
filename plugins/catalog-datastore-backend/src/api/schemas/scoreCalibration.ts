import type { SuggestionVerdict } from '../../database/SuggestionVerdictDao';
import type {
  RelationshipSuggestionEvidenceSummary,
  RelationshipSuggestionWaterfallEntry,
} from '@roadiehq/catalog-datastore-common';

export interface ScoreCalibration {
  /** base-e Platt slope over the natural-log-odds feature (see module doc). */
  a: number;
  /** base-e Platt intercept. */
  b: number;
  /** number of deduped, waterfall-bearing labels the fit used. */
  labelCount: number;
}

export const IDENTITY_CALIBRATION: ScoreCalibration = {
  a: 1,
  b: 0,
  labelCount: 0,
};

export const MIN_CALIBRATION_LABELS = 30;

const PLATT_MAX_ITERATIONS = 100;
const PLATT_MIN_STEP = 1e-10;

interface LabelledPoint {
  /** natural-log-odds feature xe = rawLogOdds * LN2. */
  xe: number;
  /** 1 = approve, 0 = dismiss. */
  y: number;
  /** stable sort key for deterministic summation order. */
  ruleId: string;
}

function reconstructLogOdds(
  evidence: RelationshipSuggestionEvidenceSummary | null | undefined,
): number | null {
  const waterfall: RelationshipSuggestionWaterfallEntry[] | undefined =
    evidence?.waterfall;
  // A corrupt/legacy row can carry a truthy non-array `waterfall` (e.g. `{}`)
  // — treat it the same as "no usable waterfall" rather than let `.reduce`
  // throw and poison every subsequent Generate run.
  if (!waterfall || !Array.isArray(waterfall) || waterfall.length === 0) {
    return null;
  }
  // The persisted waterfall INCLUDES the 'prior' entry, so the sum of
  // weights IS the model's base-2 rawLogOdds (to 3-decimal persisted
  // precision per entry — acceptable for calibration).
  const sum = waterfall.reduce((total, entry) => total + entry.weight, 0);
  // A non-numeric weight (e.g. a corrupt row) yields NaN here, which would
  // silently collapse the fit to a degenerate constant — skip the verdict
  // instead of letting it poison calibration for every candidate.
  return Number.isFinite(sum) ? sum : null;
}

// Latest verdict per rule wins (input is already ordered created_at asc, id
// asc — the last occurrence of a ruleId is its terminal judgment). approve ->
// 1, dismiss -> 0, reset -> the rule is back in the queue with no terminal
// judgment, so it contributes no label.
function toLabelledPoints(verdicts: SuggestionVerdict[]): LabelledPoint[] {
  const latestByRule = new Map<string, SuggestionVerdict>();
  for (const verdict of verdicts) {
    latestByRule.set(verdict.ruleId, verdict); // later overwrites earlier => latest wins
  }
  const points: LabelledPoint[] = [];
  for (const verdict of latestByRule.values()) {
    if (verdict.action === 'reset') {
      continue;
    }
    const rawLogOdds = reconstructLogOdds(
      verdict.evidenceSummary as RelationshipSuggestionEvidenceSummary | null,
    );
    if (rawLogOdds === null) {
      continue;
    }
    points.push({
      xe: rawLogOdds * Math.LN2,
      y: verdict.action === 'approve' ? 1 : 0,
      ruleId: verdict.ruleId,
    });
  }
  // Belt-and-suspenders: `reconstructLogOdds` already guards against a
  // non-finite sum, but drop any non-finite `xe` here too so a future
  // construction path can't feed a NaN/Infinity into the fit.
  const finitePoints = points.filter(point => Number.isFinite(point.xe));
  // Deterministic summation order (float addition is not associative).
  const codepoint = (left: string, right: string): number =>
    // eslint-disable-next-line no-nested-ternary
    left < right ? -1 : left > right ? 1 : 0;
  finitePoints.sort((left, right) =>
    left.xe !== right.xe
      ? left.xe - right.xe
      : codepoint(left.ruleId, right.ruleId),
  );
  return finitePoints;
}

interface PlattStandardFit {
  /** standard-form slope: p(y=1|f) = 1/(1+exp(slope*f+intercept)). */
  slope: number;
  /** standard-form intercept. */
  intercept: number;
}

/**
 * Transcribed from Lin, Lin & Weng (2007), "A Note on Platt's Probabilistic
 * Outputs for Support Vector Machines," Algorithm 1 (the paper's reference
 * pseudocode for Platt scaling). Fits the STANDARD-form sigmoid
 * `p(y=1|f) = 1/(1+exp(slope*f+intercept))` by minimizing the smoothed-target
 * log-loss with a damped Newton method and a backtracking line search, using
 * the log1p / branch-on-sign form of the loss (and of p/q inside the
 * gradient+Hessian loop) to avoid overflow for large |f|.
 *
 * This is a direct transcription — do not "clean up" the branching, it is
 * the numerical-stability mechanism the paper introduces over naive Platt
 * scaling, which diverges on separable data.
 *
 * `featureValues`/`labels` must be pre-sorted by the caller for determinism;
 * this function only sums in that fixed order and never reorders its input.
 */
function fitPlattStandard(
  featureValues: readonly number[],
  labels: readonly number[],
  positiveCount: number,
  negativeCount: number,
): PlattStandardFit {
  const length = featureValues.length;
  const hiTarget = (positiveCount + 1) / (positiveCount + 2);
  const loTarget = 1 / (negativeCount + 2);
  const targets = labels.map(y => (y > 0 ? hiTarget : loTarget));

  let slope = 0;
  let intercept = Math.log((negativeCount + 1) / (positiveCount + 1));

  const negLogLikelihood = (
    candidateSlope: number,
    candidateIntercept: number,
  ): number => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      const fApB = candidateSlope * featureValues[i] + candidateIntercept;
      if (fApB >= 0) {
        sum += targets[i] * fApB + Math.log1p(Math.exp(-fApB));
      } else {
        sum += (targets[i] - 1) * fApB + Math.log1p(Math.exp(fApB));
      }
    }
    return sum;
  };

  let currentLoss = negLogLikelihood(slope, intercept);

  for (let iteration = 0; iteration < PLATT_MAX_ITERATIONS; iteration += 1) {
    // Hessian (h11, h21, h21, h22) and gradient (g1, g2) of the negative
    // log-likelihood. The 1e-12 seed on the diagonal is the paper's ridge
    // term for numerical stability near-convergence.
    let h11 = 1e-12;
    let h22 = 1e-12;
    let h21 = 0;
    let g1 = 0;
    let g2 = 0;
    for (let i = 0; i < length; i += 1) {
      const fApB = slope * featureValues[i] + intercept;
      let p: number;
      let q: number;
      if (fApB >= 0) {
        p = Math.exp(-fApB) / (1 + Math.exp(-fApB));
        q = 1 / (1 + Math.exp(-fApB));
      } else {
        p = 1 / (1 + Math.exp(fApB));
        q = Math.exp(fApB) / (1 + Math.exp(fApB));
      }
      const d2 = p * q;
      h11 += featureValues[i] * featureValues[i] * d2;
      h22 += d2;
      h21 += featureValues[i] * d2;
      const d1 = targets[i] - p;
      g1 += featureValues[i] * d1;
      g2 += d1;
    }

    if (Math.abs(g1) < 1e-5 && Math.abs(g2) < 1e-5) {
      break; // converged
    }

    const det = h11 * h22 - h21 * h21;
    const deltaSlope = -(h22 * g1 - h21 * g2) / det;
    const deltaIntercept = -(-h21 * g1 + h11 * g2) / det;
    const gradientDirection = g1 * deltaSlope + g2 * deltaIntercept;

    let stepSize = 1;
    let tookStep = false;
    while (stepSize >= PLATT_MIN_STEP) {
      const candidateSlope = slope + stepSize * deltaSlope;
      const candidateIntercept = intercept + stepSize * deltaIntercept;
      const candidateLoss = negLogLikelihood(
        candidateSlope,
        candidateIntercept,
      );
      if (candidateLoss < currentLoss + 1e-4 * stepSize * gradientDirection) {
        slope = candidateSlope;
        intercept = candidateIntercept;
        currentLoss = candidateLoss;
        tookStep = true;
        break;
      }
      stepSize /= 2;
    }

    if (!tookStep) {
      // Line search could not find a descent step; stop where we are.
      break;
    }
  }

  return { slope, intercept };
}

export function computeCalibration(
  verdicts: SuggestionVerdict[],
): ScoreCalibration {
  const points = toLabelledPoints(verdicts);
  const positives = points.filter(point => point.y === 1).length;
  const negatives = points.length - positives;
  if (
    points.length < MIN_CALIBRATION_LABELS ||
    positives === 0 ||
    negatives === 0
  ) {
    return { ...IDENTITY_CALIBRATION, labelCount: points.length };
  }

  const featureValues = points.map(point => point.xe);
  const labels = points.map(point => point.y);
  const { slope, intercept } = fitPlattStandard(
    featureValues,
    labels,
    positives,
    negatives,
  );
  // Reconcile sign conventions: the standard pseudocode fits
  // p = 1/(1+exp(slope*f+intercept)) (decreasing in f for well-separated
  // positive-high data, so slope < 0 there); this module's convention is
  // p = 1/(1+exp(-(a*xe+b))) (increasing in xe for a > 0), which is the
  // same model with a = -slope, b = -intercept.
  //
  // Clamp a >= 0: a noisy or anti-correlated ~30-label log can fit a < 0,
  // which would INVERT every score in the run (higher raw confidence ->
  // lower calibrated score). A suggestion system must never invert
  // confidence; flattening toward a ~= 0 is the safe floor when the data
  // says the model is anti-predictive.
  return { a: Math.max(0, -slope), b: -intercept, labelCount: points.length };
}

export function applyCalibration(
  rawLogOdds: number,
  calibration: ScoreCalibration,
): number {
  // Value-based (not reference-based) identity short-circuit. Below
  // MIN_CALIBRATION_LABELS, computeCalibration returns `{...IDENTITY_CALIBRATION,
  // labelCount: n}` — an identity-valued but reference-distinct object — and
  // that path is the common early-production case. Without this check,
  // `(rawLogOdds*LN2)/LN2` is off by 1 ULP from `rawLogOdds` for a
  // significant fraction of doubles, silently breaking the "identity is an
  // exact no-op" contract Task 3 relies on.
  if (calibration.a === 1 && calibration.b === 0) {
    return rawLogOdds;
  }
  const xe = rawLogOdds * Math.LN2;
  const ze = calibration.a * xe + calibration.b;
  return ze / Math.LN2; // back to base-2 log-odds for the caller's sigmoid
}
