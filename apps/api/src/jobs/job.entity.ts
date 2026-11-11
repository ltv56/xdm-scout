import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

@Entity('jobs')
@Index(['status', 'runAt'])
export class Job {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 32 })
  type!: string

  @Column({ type: 'json' })
  payload!: { attemptId: number }

  @Column({ type: 'datetime', precision: 3 })
  runAt!: Date

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: JobStatus

  @Column({ type: 'text', nullable: true })
  error!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
