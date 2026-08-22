import { decisionDisplayGuidance, decisionNeedsMoreSamples, scoreLabel, type ConfidenceLevel, type DecisionAnalysis } from "../review/learning";
import type { AnalysisStatus } from "../review/analyze";
import { VILLAIN_BY_ID } from "../villains/catalog";

const CONFIDENCE_KO: Record<ConfidenceLevel, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
};

const STATUS_KO: Record<AnalysisStatus, string> = {
  preliminary: "빠른 분석 · 정밀 EV 비교 중",
  final: "정밀 분석 완료",
  limited: "빠른 분석 · 정밀 EV 제한",
};

export function confidenceKo(confidence: ConfidenceLevel): string {
  return CONFIDENCE_KO[confidence];
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}bb`;
}

export function DecisionCoachCard({
  analysis,
  status = "final",
  compact = false,
}: {
  analysis: DecisionAnalysis;
  status?: AnalysisStatus;
  compact?: boolean;
}) {
  const score = Math.round(analysis.overallScore);
  const uncertain = decisionNeedsMoreSamples(analysis);
  const label = uncertain ? "판단 보류" : scoreLabel(score);
  const scoreClass = uncertain ? "caution" : score >= 95 ? "best" : score >= 80 ? "good" : score >= 65 ? "caution" : "mistake";
  const confidence = confidenceKo(analysis.confidence);
  const loss = Math.max(analysis.baselineLossBb, analysis.exploitLossBb ?? 0);
  const exploitDrivesLoss = analysis.exploitScore !== undefined
    && (analysis.exploitLossBb ?? 0) >= analysis.baselineLossBb;
  const lossScore = exploitDrivesLoss ? analysis.exploitScore! : analysis.fundamentalsScore;
  const lossLabel = `${exploitDrivesLoss ? "상대 맞춤" : "기본기"} · ${scoreLabel(lossScore)}`;
  const guidance = decisionDisplayGuidance(analysis);
  const next = guidance.nextRule;

  return (
    <article
      className={`decision-coach ${compact ? "compact" : "full"}`}
      aria-label={`종합 코칭 점수 ${uncertain ? "잠정 " : ""}${score}점, ${label}, 신뢰도 ${confidence}`}
    >
      <header className="coach-head">
        <div className={`coach-score score-${scoreClass}`}><strong>{score}</strong><span>{uncertain ? "잠정" : "점"}</span></div>
        <div>
          <div className="coach-status" role={status === "preliminary" ? "status" : undefined} aria-live={status === "preliminary" ? "polite" : undefined}>
            {STATUS_KO[status]} · 신뢰도 {confidence}
          </div>
          <h3>{guidance.judgment}</h3>
          <p>{analysis.context.street.toUpperCase()} · 팟 {analysis.context.potBb.toFixed(1)}bb{analysis.context.opponentId ? ` · ${VILLAIN_BY_ID[analysis.context.opponentId]?.name ?? analysis.context.opponentId}` : ""}</p>
        </div>
      </header>

      <dl className="coach-compare">
        <div><dt>내 선택</dt><dd>{analysis.played.label}<em>{signed(analysis.played.evBb)}</em></dd></div>
        <div><dt>기본 전략 근사</dt><dd>{analysis.baselineBest.label}<em>{signed(analysis.baselineBest.evBb)}</em></dd></div>
        {analysis.exploitBest && <div><dt>상대 맞춤</dt><dd>{analysis.exploitBest.label}<em>{analysis.exploitScore === undefined ? "—" : `${Math.round(analysis.exploitScore)}점`}</em></dd></div>}
        <div><dt>추정 손실</dt><dd>{uncertain ? "판단 보류" : loss > 0 ? `${loss.toFixed(1)}bb` : "없음"}<em>{uncertain && analysis.baselineRawLossBb !== undefined ? `원시 차이 ${analysis.baselineRawLossBb.toFixed(1)}bb` : lossLabel}</em></dd></div>
      </dl>

      <div className="coach-next">
        <span>다음 기준</span>
        <b>{next.condition}</b>
        <p>{next.action}</p>
        {next.exception && <small>예외 · {next.exception}</small>}
      </div>

      {!compact && (
        <div className="coach-detail">
          <section>
            <b>근거</b>
            {guidance.evidence.map((evidence) => <p key={evidence}>{evidence}</p>)}
          </section>
          <section><b>원칙</b><p>{guidance.principle}</p></section>
          <section><b>교정 목표</b><p>다음 {guidance.measurementTarget.opportunities}번의 같은 기회에서 놓침 {guidance.measurementTarget.maxMisses}회 이하</p></section>
        </div>
      )}
    </article>
  );
}
