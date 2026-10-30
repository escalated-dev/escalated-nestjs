import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Single-use SSO message IDs (escalated-laravel's `escalated_sso_message_ids`):
 * the SAML AuthnRequest IDs Escalated issued (`saml_request`), and the SAML
 * assertion IDs (`saml_assertion`) and JWT `jti`s (`jwt`) it has accepted.
 * Kept until `expiresAt` (Unix seconds).
 */
@Entity('escalated_sso_message_ids')
@Index(['kind', 'messageId'], { unique: true })
export class SsoMessageId {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 32 })
  kind: string;

  @Column({ type: 'varchar', length: 191 })
  messageId: string;

  @Index()
  @Column({
    type: 'bigint',
    transformer: { to: (value: number) => value, from: (value: unknown) => Number(value) },
  })
  expiresAt: number;
}
