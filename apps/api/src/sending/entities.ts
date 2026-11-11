import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm'

@Entity('sender_accounts')
export class SenderAccount {
  @PrimaryGeneratedColumn()
  id!: number

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  xUserId!: string

  @Column({ type: 'varchar', length: 64 })
  handle!: string

  @Column({ type: 'text', nullable: true })
  accessTokenEnc!: string | null

  @Column({ type: 'text', nullable: true })
  refreshTokenEnc!: string | null

  @Column({ type: 'datetime', precision: 3, nullable: true })
  tokenExpiresAt!: Date | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  scope!: string | null
}

@Entity('x_users')
export class XUser {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  xUserId!: string

  @Column({ type: 'varchar', length: 64 })
  handle!: string
}

export type RelationshipContext = 'messaged_us' | 'follower' | 'engaged' | 'adjacent' | 'cold'
export type RecipientPermission = 'requested_dm' | 'none'

@Entity('contacts')
@Unique(['senderAccountId', 'xUserId'])
export class Contact {
  @PrimaryGeneratedColumn()
  id!: number

  @Column()
  senderAccountId!: number

  @Column({ type: 'varchar', length: 32 })
  xUserId!: string

  @Column({ type: 'varchar', length: 16, default: 'cold' })
  relationshipContext!: RelationshipContext

  @Column({ type: 'varchar', length: 16, default: 'none' })
  recipientPermission!: RecipientPermission

  @Column({ type: 'int', nullable: true })
  activeAttemptId!: number | null
}

export type DraftStatus = 'pending' | 'approved' | 'skipped' | 'superseded'

@Entity('drafts')
export class Draft {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column()
  contactId!: number

  @Column({ type: 'text' })
  content!: string

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: DraftStatus

  @Column({ type: 'char', length: 64, nullable: true })
  approvedHash!: string | null
}

export type AttemptStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'needs_decision'
  | 'manual_pending'
  | 'manual_unverified'
  | 'cancelled'

@Entity('send_attempts')
export class SendAttempt {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column()
  contactId!: number

  @Column()
  draftId!: number

  @Column({ type: 'varchar', length: 8, default: 'api' })
  route!: 'api' | 'manual'

  @Column({ type: 'varchar', length: 24, default: 'queued' })
  status!: AttemptStatus

  @Column({ type: 'char', length: 64 })
  contentHash!: string

  @Column({ type: 'varchar', length: 64, nullable: true })
  xConversationId!: string | null

  @Column({ type: 'varchar', length: 32, nullable: true })
  xEventId!: string | null

  @Column({ type: 'datetime', precision: 3, nullable: true })
  runAt!: Date | null

  @Column({ type: 'datetime', precision: 3, nullable: true })
  unknownAt!: Date | null

  @Column({ type: 'text', nullable: true })
  error!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}

@Entity('do_not_contact')
export class DoNotContact {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  xUserId!: string

  @Column({ type: 'varchar', length: 255 })
  reason!: string

  @Column({ type: 'varchar', length: 32 })
  source!: string

  @CreateDateColumn()
  createdAt!: Date
}
