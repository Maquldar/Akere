'use client';

import { AlertTriangle, Camera, CheckCircle2, ImageUp, Loader2, MapPin, RefreshCw, ScanFace } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { isApiError } from '@/lib/api/errors';
import { useCreateMark } from '@/lib/api/hooks/time';
import type { MarkResult, MyDay, TimeMarkType } from '@/lib/api/types-time';
import { cn } from '@/lib/utils';
import { captureFrame, getPosition, isGeoError, stopStream, type GeoError, type GeoFix } from './geo';

type Phase = 'capture' | 'submitting' | 'success' | 'error';
type CameraState = 'starting' | 'live' | 'unavailable';
type Problem =
  | { kind: 'geofence'; distanceM?: number; radiusM?: number; location?: string }
  | { kind: 'geo'; reason: GeoError | 'required' }
  | { kind: 'selfie' }
  | { kind: 'sequence' }
  | { kind: 'generic'; message: string };

/**
 * "Подтвердите личность" (M4 0:28): live front camera in a circle → snapshot → upload with geolocation.
 * Without `requireSelfie` the camera step is skipped. The camera is released right after capture.
 */
export function IdentityDialog({
  open,
  onOpenChange,
  type,
  settings,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: Extract<TimeMarkType, 'IN' | 'OUT'>;
  settings: MyDay['settings'];
  onSuccess: (result: MarkResult) => void;
}) {
  const t = useTranslations('time.identity');
  const tc = useTranslations('common');
  const mark = useCreateMark();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef<Promise<GeoFix> | null>(null);
  const [phase, setPhase] = useState<Phase>('capture');
  const [camera, setCamera] = useState<CameraState>('starting');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [result, setResult] = useState<MarkResult | null>(null);
  const needSelfie = settings.requireSelfie;

  const releaseCamera = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Reset on open; start locating right away so the fix is ready by the time the photo is taken.
  useEffect(() => {
    if (!open) return;
    setPhase('capture');
    setPhoto(null);
    setProblem(null);
    setResult(null);
    geoRef.current = getPosition();
    geoRef.current.catch(() => undefined);
  }, [open]);

  // Live camera while capturing without a photo.
  useEffect(() => {
    if (!open || !needSelfie || phase !== 'capture' || photo) return;
    let cancelled = false;
    setCamera('starting');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false })
      .then(async (stream) => {
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          try {
            await v.play();
          } catch {
            /* autoplay may need the muted attribute only */
          }
        }
        setCamera('live');
      })
      .catch(() => {
        if (!cancelled) setCamera('unavailable');
      });
    return () => {
      cancelled = true;
      releaseCamera();
    };
  }, [open, needSelfie, phase, photo, releaseCamera]);

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => () => releaseCamera(), [releaseCamera]);

  const submit = async (selfie: File | null) => {
    setPhase('submitting');
    setProblem(null);
    let fix: GeoFix | null = null;
    try {
      fix = await (geoRef.current ?? getPosition());
    } catch (e) {
      if (settings.requireGeofence && settings.location) {
        setProblem({ kind: 'geo', reason: isGeoError(e) ? e : 'unavailable' });
        setPhase('error');
        return;
      }
    }
    try {
      const res = await mark.mutateAsync({ type, selfie, ...(fix ?? {}) });
      setResult(res);
      setPhase('success');
      setTimeout(() => {
        onSuccess(res);
        onOpenChange(false);
      }, res.mark.verification === 'FAILED' ? 2200 : 1200);
    } catch (e) {
      if (isApiError(e) && e.code === 'BUSINESS_RULE') {
        const d = (e.details ?? {}) as { distanceM?: number; radiusM?: number; location?: string };
        if (e.rule === 'OUTSIDE_GEOFENCE') setProblem({ kind: 'geofence', ...d });
        else if (e.rule === 'GEOLOCATION_REQUIRED') setProblem({ kind: 'geo', reason: 'required' });
        else if (e.rule === 'SELFIE_REQUIRED') setProblem({ kind: 'selfie' });
        else if (e.rule === 'INVALID_SEQUENCE') setProblem({ kind: 'sequence' });
        else setProblem({ kind: 'generic', message: e.message });
      } else setProblem({ kind: 'generic', message: isApiError(e) ? e.message : tc('error') });
      setPhase('error');
    }
  };

  const takePhoto = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const file = await captureFrame(v);
      releaseCamera();
      setPhoto(file);
      await submit(file);
    } catch {
      setCamera('unavailable');
    }
  };

  const retry = () => {
    if (problem?.kind === 'geo' || problem?.kind === 'geofence') {
      geoRef.current = getPosition();
      geoRef.current.catch(() => undefined);
    }
    if (needSelfie && (!photo || problem?.kind === 'selfie')) {
      setPhoto(null);
      setPhase('capture');
      return;
    }
    void submit(photo);
  };

  const retake = () => {
    setPhoto(null);
    setProblem(null);
    setPhase('capture');
  };

  const problemText = (p: Problem): string => {
    switch (p.kind) {
      case 'geofence':
        return p.distanceM !== undefined && p.radiusM !== undefined
          ? t('outsideGeofence', { distance: p.distanceM, radius: p.radiusM, location: p.location ?? settings.location?.name ?? '' })
          : t('outsideGeofenceShort');
      case 'geo':
        return p.reason === 'denied' ? t('geoDenied') : p.reason === 'unsupported' ? t('geoUnsupported') : p.reason === 'required' ? t('geoRequired') : t('geoUnavailable');
      case 'selfie':
        return t('selfieRequired');
      case 'sequence':
        return t('invalidSequence');
      default:
        return p.message;
    }
  };

  const busy = phase === 'submitting';
  const title = type === 'IN' ? t('titleIn') : t('titleOut');

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) releaseCamera();
        onOpenChange(o);
      }}
      title={needSelfie ? t('title') : title}
      description={needSelfie ? title : undefined}
      size="sm"
      dismissible={!busy}
    >
      <div className="flex flex-col items-center gap-4 pt-2 text-center">
        {needSelfie && (
          <div
            className={cn(
              'relative flex size-56 items-center justify-center overflow-hidden rounded-full border-4 bg-surface-hover sm:size-60',
              phase === 'success' ? 'border-green-solid' : phase === 'error' ? 'border-red-solid' : 'border-primary/30',
            )}
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt={t('photoAlt')} className="size-full object-cover" />
            ) : (
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                aria-label={t('cameraLabel')}
                className={cn('size-full -scale-x-100 object-cover', camera !== 'live' && 'invisible')}
              />
            )}
            {!photoUrl && camera === 'starting' && (
              <Loader2 className="absolute size-8 animate-spin text-fg-subtle" aria-label={t('cameraStarting')} />
            )}
            {!photoUrl && camera === 'unavailable' && (
              <div className="absolute flex flex-col items-center gap-2 px-6 text-fg-muted">
                <ScanFace className="size-10" aria-hidden />
                <span className="text-xs">{t('cameraUnavailable')}</span>
              </div>
            )}
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                <Loader2 className="size-9 animate-spin text-white" aria-hidden />
              </div>
            )}
            {phase === 'success' && (
              <div className="absolute inset-0 flex items-center justify-center bg-green-solid/25">
                <CheckCircle2 className="size-14 text-white drop-shadow" aria-hidden />
              </div>
            )}
          </div>
        )}

        <div aria-live="polite" className="min-h-10">
          {phase === 'capture' && needSelfie && camera !== 'unavailable' && <p className="text-sm text-fg-muted">{t('lookAtCamera')}</p>}
          {phase === 'capture' && needSelfie && camera === 'unavailable' && <p className="text-sm text-fg-muted">{t('uploadHint')}</p>}
          {phase === 'capture' && !needSelfie && (
            <p className="flex items-center justify-center gap-1.5 text-sm text-fg-muted">
              <MapPin className="size-4" aria-hidden />
              {settings.requireGeofence && settings.location ? t('geoCheck', { location: settings.location.name }) : t('confirmHint')}
            </p>
          )}
          {busy && <p className="text-sm text-fg-muted">{t('verifying')}</p>}
          {phase === 'success' && result && (
            <div className="flex flex-col items-center gap-1">
              <p className="flex items-center gap-1.5 text-[15px] font-semibold text-green-fg">
                <CheckCircle2 className="size-5" aria-hidden />
                {result.mark.verification === 'FAILED' ? t('savedForReview') : t('passed')}
              </p>
              {result.mark.verification === 'FAILED' && <p className="text-xs text-fg-muted">{t('reviewHint')}</p>}
              {result.mark.distanceM !== null && <p className="text-xs text-fg-subtle">{t('distance', { distance: result.mark.distanceM })}</p>}
            </div>
          )}
          {phase === 'error' && problem && (
            <p role="alert" className="flex items-start justify-center gap-1.5 text-sm font-medium text-red-fg">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{problemText(problem)}</span>
            </p>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png"
          capture="user"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) {
              releaseCamera();
              setPhoto(f);
              void submit(f);
            }
          }}
        />

        <div className="flex w-full flex-col gap-2">
          {phase === 'capture' && needSelfie && camera === 'live' && (
            <Button size="lg" onClick={takePhoto} className="w-full">
              <Camera />
              {t('takePhoto')}
            </Button>
          )}
          {phase === 'capture' && needSelfie && camera === 'unavailable' && (
            <Button size="lg" onClick={() => fileRef.current?.click()} className="w-full">
              <ImageUp />
              {t('uploadPhoto')}
            </Button>
          )}
          {phase === 'capture' && needSelfie && camera !== 'unavailable' && (
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              <ImageUp />
              {t('uploadInstead')}
            </Button>
          )}
          {phase === 'capture' && !needSelfie && (
            <Button size="lg" onClick={() => submit(null)} className="w-full">
              {type === 'IN' ? t('confirmIn') : t('confirmOut')}
            </Button>
          )}
          {phase === 'error' && (
            <>
              <Button size="lg" onClick={retry} className="w-full">
                <RefreshCw />
                {tc('retry')}
              </Button>
              {needSelfie && photo && problem?.kind !== 'selfie' && (
                <Button variant="ghost" size="sm" onClick={retake}>
                  <Camera />
                  {t('retake')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
