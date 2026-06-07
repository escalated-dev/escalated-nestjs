import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { NewsletterList } from './newsletter-list.entity';
import { Contact } from '../contact.entity';
import { userIdColumn, UserId } from '../../config/user-id-column';

@Entity('escalated_newsletter_list_members')
@Unique(['list_id', 'contact_id'])
export class NewsletterListMember {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  list_id: number;

  @Index()
  @Column()
  contact_id: number;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  added_at: Date;

  @Column(userIdColumn({ nullable: true }))
  added_by: UserId | null;

  @ManyToOne(() => NewsletterList, (l) => l.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'list_id' })
  list: NewsletterList;

  @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;
}
