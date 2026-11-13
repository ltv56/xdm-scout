import type { StoredSentence } from '../review/checks'
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

  @Column({ type: 'varchar', length: 128, nullable: true })
  name!: string | null

  @Column({ type: 'text', nullable: true })
  bio!: string | null

  @Column({ type: 'int', nullable: true })
  followers!: number | null

  @Column({ type: 'boolean', default: false })
  isProtected!: boolean

  @Column({ type: 'varchar', length: 16, nullable: true })
  orgType!: string | null

  @Column({ type: 'boolean', default: false })
  receivesYourDm!: boolean

  @Column({ type: 'datetime', precision: 3, nullable: true })
  fetchedAt!: Date | null
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

  // The inbound DM the operator confirmed as an invitation; API sending depends on it.
  @Column({ type: 'varchar', length: 32, nullable: true })
  invitationEventId!: string | null

  @Column({ type: 'datetime', precision: 3, nullable: true })
  invitationAt!: Date | null

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

  @Column({ type: 'int', nullable: true })
  prospectId!: number | null

  @Column({ type: 'varchar', length: 16, default: 'first_message' })
  kind!: 'first_message' | 'reply'

  @Column({ type: 'varchar', length: 16, default: 'HUMAN_HANDOFF' })
  sendPath!: 'API_SEND' | 'HUMAN_HANDOFF'

  // Each sentence with where it came from; null source = nothing backs it.
  @Column({ type: 'json', nullable: true })
  sentences!: StoredSentence[] | null

  @Column({ type: 'boolean', default: false })
  editedByReviewer!: boolean

  // What the model wrote, kept when the reviewer edits it.
  @Column({ type: 'text', nullable: true })
  originalContent!: string | null

  @Column({ type: 'varchar', length: 2, default: 'en' })
  language!: 'en' | 'vi' | 'th' | 'id'

  // The English version kept beside a translated draft; null when the draft is in English.
  @Column({ type: 'text', nullable: true })
  englishText!: string | null

  // The English sentences, kept so a translated draft can go back to them with their sources.
  @Column({ type: 'json', nullable: true })
  englishSentences!: StoredSentence[] | null
}

export type AttemptStatus =
  // Approved API draft holding the send right; the worker never sees it until Send moves it to queued.
  | 'approved'
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
