/** Additive native mirror protocol; web and satellite protocols stay unchanged. */
export const MOBILE_PROTOCOL = 1;
export const MOBILE_FRAME_MAX = 240_000;
export interface MobileEndpoint { url: string; trust: 'pinned' | 'system' }
export interface MobileInvitation {
  protocol: 1; serverId: string; keyFingerprint: string;
  endpoints: MobileEndpoint[]; invitation: string; expiresAt: number;
}
export interface MobileDevice { id: string; name: string; createdAt: number }
export interface MobileMirror { deviceId: string; generation: string; background: boolean }
export const mobilePath = (url: string) => /^\/mobile\/(?:pair|info|events|audio|camera|images\/[a-zA-Z0-9_-]+\.webp)(?:\?|$)/u.test(url);
