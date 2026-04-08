import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { AgentProfile } from '../entities/agent-profile.entity';

@Injectable()
export class TwoFactorService {
  constructor(
    @InjectRepository(AgentProfile)
    private readonly agentProfileRepo: Repository<AgentProfile>,
  ) {}

  async generateSecret(userId: number, appName: string = 'Escalated'): Promise<{
    secret: string;
    qrCodeUrl: string;
    recoveryCodes: string[];
  }> {
    const profile = await this.agentProfileRepo.findOne({ where: { userId } });
    if (!profile) throw new BadRequestException('Agent profile not found');

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(
      `user-${userId}`,
      appName,
      secret,
    );
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Generate recovery codes
    const recoveryCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase(),
    );

    // Store temporarily (not enabled until verified)
    await this.agentProfileRepo.update(profile.id, {
      twoFactorSecret: secret,
      twoFactorRecoveryCodes: recoveryCodes,
    });

    return { secret, qrCodeUrl, recoveryCodes };
  }

  async enable(userId: number, token: string): Promise<boolean> {
    const profile = await this.agentProfileRepo.findOne({ where: { userId } });
    if (!profile || !profile.twoFactorSecret) {
      throw new BadRequestException('No 2FA secret found. Generate one first.');
    }

    const isValid = authenticator.verify({
      token,
      secret: profile.twoFactorSecret,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    await this.agentProfileRepo.update(profile.id, {
      twoFactorEnabled: true,
    });

    return true;
  }

  async verify(userId: number, token: string): Promise<boolean> {
    const profile = await this.agentProfileRepo.findOne({ where: { userId } });
    if (!profile || !profile.twoFactorEnabled || !profile.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled');
    }

    // Check TOTP code
    const isValid = authenticator.verify({
      token,
      secret: profile.twoFactorSecret,
    });

    if (isValid) return true;

    // Check recovery codes
    if (profile.twoFactorRecoveryCodes?.includes(token)) {
      const updatedCodes = profile.twoFactorRecoveryCodes.filter((c) => c !== token);
      await this.agentProfileRepo.update(profile.id, {
        twoFactorRecoveryCodes: updatedCodes,
      });
      return true;
    }

    return false;
  }

  async disable(userId: number): Promise<void> {
    const profile = await this.agentProfileRepo.findOne({ where: { userId } });
    if (!profile) throw new BadRequestException('Agent profile not found');

    await this.agentProfileRepo.update(profile.id, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorRecoveryCodes: null,
    });
  }

  async isEnabled(userId: number): Promise<boolean> {
    const profile = await this.agentProfileRepo.findOne({ where: { userId } });
    return profile?.twoFactorEnabled || false;
  }
}
