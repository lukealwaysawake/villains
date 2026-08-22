import { useEffect, useRef } from "react";
import { finalizeHandAnalysis, type Profile, type Session } from "../state/store";
import { buildReviewAnalysis } from "./coaching";
import { scoreDecisionsAsync } from "./evClient";

export function useAnalysisCoordinator({
  profile,
  setProfile,
  session,
  setSession,
}: {
  profile: Profile;
  setProfile: (profile: Profile) => void;
  session: Session | null;
  setSession: (session: Session) => void;
}) {
  const profileRef = useRef(profile);
  const sessionRef = useRef(session);
  const activeJobId = useRef<string | null>(null);
  profileRef.current = profile;
  sessionRef.current = session;

  const nextJob = profile.learning.pendingJobs[0];
  const jobSignature = nextJob ? `${nextJob.id}:${nextJob.createdAt}` : "";

  useEffect(() => {
    const job = profileRef.current.learning.pendingJobs[0];
    if (!job || activeJobId.current === job.id) return;
    activeJobId.current = job.id;
    const sampleCount = Math.max(12, Math.min(20, Math.floor(80 / Math.max(1, job.decisions.length))));

    void scoreDecisionsAsync({
      decisions: job.decisions,
      samples: sampleCount,
      tell: job.tellDifficulty,
    }).then((scores) => {
      const latestProfile = structuredClone(profileRef.current);
      const currentJob = latestProfile.learning.pendingJobs.find((candidate) => candidate.id === job.id);
      if (!currentJob) return;
      const status = scores ? "final" : "limited";
      const review = buildReviewAnalysis({
        review: currentJob.review,
        status,
        sessionId: currentJob.sessionId,
        handNumber: currentJob.handNumber,
        decisions: currentJob.decisions,
        scores,
      });
      const currentSession = sessionRef.current;
      const targetSession = currentSession?.id === currentJob.sessionId
        ? structuredClone(currentSession)
        : latestProfile.lastSession?.id === currentJob.sessionId
          ? structuredClone(latestProfile.lastSession)
          : null;
      finalizeHandAnalysis(latestProfile, targetSession, review);
      profileRef.current = latestProfile;
      setProfile(latestProfile);
      if (targetSession && currentSession?.id === targetSession.id) {
        sessionRef.current = targetSession;
        setSession(targetSession);
      }
    }).finally(() => {
      if (activeJobId.current === job.id) activeJobId.current = null;
    });
  }, [jobSignature, setProfile, setSession]);
}

