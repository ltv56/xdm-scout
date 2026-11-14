import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

// A reply to one of our sends. source=operator: they replied in an encrypted chat the API can't read, so there is no text.
@Entity('replies')
export class Reply {
  @PrimaryGeneratedColumn()
  id!: number

  @Index()
  @Column()
  contactId!: number

  @Column()
  attemptId!: number

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  xEventId!: string | null

  @Column({ type: 'text', nullable: true })
  text!: string | null

  @Column({ type: 'varchar', length: 8 })
  source!: 'api' | 'operator'

  @Column({ type: 'datetime', precision: 3 })
  at!: Date

  @Column({ type: 'datetime', precision: 3, nullable: true })
  handledAt!: Date | null
}
