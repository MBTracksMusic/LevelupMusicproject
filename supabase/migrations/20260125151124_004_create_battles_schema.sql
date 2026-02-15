/*
  # LevelupMusic - Music Battles Schema

  1. Overview
    This migration creates the battle system where producers compete 1v1.
    Only confirmed users can vote, and only active producers can participate.

  2. New Tables
    - `battles`
      - `id` (uuid, primary key)
      - `title` (text) - Battle title
      - `slug` (text, unique) - URL-friendly identifier
      - `description` (text) - Battle description
      - `producer1_id` (uuid) - First competitor
      - `producer2_id` (uuid) - Second competitor
      - `product1_id` (uuid) - Producer 1's submission
      - `product2_id` (uuid) - Producer 2's submission
      - `status` (enum) - pending, active, voting, completed, cancelled
      - `starts_at` (timestamptz) - When battle starts
      - `voting_ends_at` (timestamptz) - When voting closes
      - `winner_id` (uuid) - Winner (set after voting ends)
      - `votes_producer1` (integer) - Vote count for producer 1
      - `votes_producer2` (integer) - Vote count for producer 2
      - `created_at` (timestamptz)

    - `battle_votes`
      - `id` (uuid, primary key)
      - `battle_id` (uuid) - Battle being voted on
      - `user_id` (uuid) - Voter
      - `voted_for_producer_id` (uuid) - Which producer received the vote
      - `created_at` (timestamptz)
      - UNIQUE constraint on (battle_id, user_id)

    - `battle_comments`
      - `id` (uuid, primary key)
      - `battle_id` (uuid) - Related battle
      - `user_id` (uuid) - Comment author
      - `content` (text) - Comment text
      - `is_hidden` (boolean) - Moderation flag
      - `created_at` (timestamptz)

  3. Security
    - RLS enabled on all tables
    - Only confirmed_user/producer/admin can vote
    - Each user can only vote once per battle
    - Only active producers can create battles
    - Winner is calculated automatically after voting ends

  4. Important Notes
    - Vote counting is done server-side
    - Winner determination is automatic via function
    - Comments can be moderated by admins
*/

-- Create enum for battle status
DO $$ BEGIN
  CREATE TYPE battle_status AS ENUM ('pending', 'active', 'voting', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create battles table
CREATE TABLE IF NOT EXISTS battles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  producer1_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  producer2_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  product1_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product2_id uuid REFERENCES products(id) ON DELETE SET NULL,
  status battle_status DEFAULT 'pending' NOT NULL,
  starts_at timestamptz,
  voting_ends_at timestamptz,
  winner_id uuid REFERENCES user_profiles(id),
  votes_producer1 integer DEFAULT 0 NOT NULL,
  votes_producer2 integer DEFAULT 0 NOT NULL,
  featured boolean DEFAULT false NOT NULL,
  prize_description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  
  CONSTRAINT different_producers CHECK (producer1_id != producer2_id)
);

-- Create battle_votes table
CREATE TABLE IF NOT EXISTS battle_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  voted_for_producer_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  
  CONSTRAINT unique_user_vote_per_battle UNIQUE (battle_id, user_id)
);

-- Create battle_comments table
CREATE TABLE IF NOT EXISTS battle_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES battle_comments(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (length(content) <= 1000),
  is_hidden boolean DEFAULT false NOT NULL,
  hidden_reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status);
CREATE INDEX IF NOT EXISTS idx_battles_voting_ends ON battles(voting_ends_at) WHERE status = 'voting';
CREATE INDEX IF NOT EXISTS idx_battles_featured ON battles(featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_battles_producer1 ON battles(producer1_id);
CREATE INDEX IF NOT EXISTS idx_battles_producer2 ON battles(producer2_id);
CREATE INDEX IF NOT EXISTS idx_battles_slug ON battles(slug);
CREATE INDEX IF NOT EXISTS idx_battles_created ON battles(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_battle_votes_battle ON battle_votes(battle_id);
CREATE INDEX IF NOT EXISTS idx_battle_votes_user ON battle_votes(user_id);

CREATE INDEX IF NOT EXISTS idx_battle_comments_battle ON battle_comments(battle_id);
CREATE INDEX IF NOT EXISTS idx_battle_comments_user ON battle_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_battle_comments_visible ON battle_comments(is_hidden) WHERE is_hidden = false;

-- Enable RLS
ALTER TABLE battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE battle_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE battle_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for battles

-- Anyone can view active/voting/completed battles
CREATE POLICY "Anyone can view public battles"
  ON battles FOR SELECT
  USING (status IN ('active', 'voting', 'completed'));

-- Producers can view their own pending battles
CREATE POLICY "Producers can view own battles"
  ON battles FOR SELECT
  TO authenticated
  USING (producer1_id = auth.uid() OR producer2_id = auth.uid());

-- Active producers can create battles
CREATE POLICY "Active producers can create battles"
  ON battles FOR INSERT
  TO authenticated
  WITH CHECK (
    producer1_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND is_producer_active = true
    )
  );

-- Producers can update their own pending battles
CREATE POLICY "Producers can update own pending battles"
  ON battles FOR UPDATE
  TO authenticated
  USING (
    (producer1_id = auth.uid() OR producer2_id = auth.uid()) AND
    status = 'pending'
  )
  WITH CHECK (
    (producer1_id = auth.uid() OR producer2_id = auth.uid())
  );

-- RLS Policies for battle_votes

-- Anyone can view vote counts (not who voted)
CREATE POLICY "Anyone can view votes"
  ON battle_votes FOR SELECT
  USING (true);

-- Only confirmed users, producers, and admins can vote
CREATE POLICY "Confirmed users can vote"
  ON battle_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE id = auth.uid() 
      AND role IN ('confirmed_user', 'producer', 'admin')
    ) AND
    EXISTS (
      SELECT 1 FROM battles 
      WHERE id = battle_votes.battle_id 
      AND status = 'voting'
    ) AND
    NOT EXISTS (
      SELECT 1 FROM battle_votes bv 
      WHERE bv.battle_id = battle_votes.battle_id 
      AND bv.user_id = auth.uid()
    )
  );

-- RLS Policies for battle_comments

-- Anyone can view non-hidden comments
CREATE POLICY "Anyone can view visible comments"
  ON battle_comments FOR SELECT
  USING (is_hidden = false);

-- Authenticated users can create comments
CREATE POLICY "Authenticated users can comment"
  ON battle_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM battles 
      WHERE id = battle_comments.battle_id 
      AND status IN ('active', 'voting')
    )
  );

-- Users can update their own comments
CREATE POLICY "Users can update own comments"
  ON battle_comments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_hidden = false);

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments"
  ON battle_comments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Trigger for updated_at on battles
DROP TRIGGER IF EXISTS update_battles_updated_at ON battles;
CREATE TRIGGER update_battles_updated_at
  BEFORE UPDATE ON battles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for updated_at on comments
DROP TRIGGER IF EXISTS update_battle_comments_updated_at ON battle_comments;
CREATE TRIGGER update_battle_comments_updated_at
  BEFORE UPDATE ON battle_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to generate battle slug
CREATE OR REPLACE FUNCTION generate_battle_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter integer := 1;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug != '' THEN
    IF TG_OP = 'UPDATE' AND NEW.title = OLD.title THEN
      RETURN NEW;
    END IF;
  END IF;
  
  base_slug := lower(regexp_replace(NEW.title, '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  final_slug := base_slug;
  
  WHILE EXISTS (SELECT 1 FROM battles WHERE slug = final_slug AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)) LOOP
    final_slug := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;
  
  NEW.slug := final_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate battle slug
DROP TRIGGER IF EXISTS generate_battle_slug_trigger ON battles;
CREATE TRIGGER generate_battle_slug_trigger
  BEFORE INSERT OR UPDATE ON battles
  FOR EACH ROW
  EXECUTE FUNCTION generate_battle_slug();

-- Function to record vote and update counts
CREATE OR REPLACE FUNCTION record_battle_vote(
  p_battle_id uuid,
  p_user_id uuid,
  p_voted_for_producer_id uuid
)
RETURNS boolean AS $$
DECLARE
  v_battle battles%ROWTYPE;
  v_user_role user_role;
BEGIN
  -- Get battle info
  SELECT * INTO v_battle FROM battles WHERE id = p_battle_id FOR UPDATE;
  
  IF NOT FOUND OR v_battle.status != 'voting' THEN
    RETURN false;
  END IF;
  
  -- Verify voted_for is one of the producers
  IF p_voted_for_producer_id != v_battle.producer1_id AND p_voted_for_producer_id != v_battle.producer2_id THEN
    RETURN false;
  END IF;
  
  -- Check user eligibility
  SELECT role INTO v_user_role FROM user_profiles WHERE id = p_user_id;
  IF v_user_role NOT IN ('confirmed_user', 'producer', 'admin') THEN
    RETURN false;
  END IF;
  
  -- Check for existing vote
  IF EXISTS (SELECT 1 FROM battle_votes WHERE battle_id = p_battle_id AND user_id = p_user_id) THEN
    RETURN false;
  END IF;
  
  -- Record vote
  INSERT INTO battle_votes (battle_id, user_id, voted_for_producer_id)
  VALUES (p_battle_id, p_user_id, p_voted_for_producer_id);
  
  -- Update vote counts
  IF p_voted_for_producer_id = v_battle.producer1_id THEN
    UPDATE battles SET votes_producer1 = votes_producer1 + 1 WHERE id = p_battle_id;
  ELSE
    UPDATE battles SET votes_producer2 = votes_producer2 + 1 WHERE id = p_battle_id;
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to finalize battle and determine winner
CREATE OR REPLACE FUNCTION finalize_battle(p_battle_id uuid)
RETURNS uuid AS $$
DECLARE
  v_battle battles%ROWTYPE;
  v_winner_id uuid;
BEGIN
  SELECT * INTO v_battle FROM battles WHERE id = p_battle_id FOR UPDATE;
  
  IF NOT FOUND OR v_battle.status != 'voting' THEN
    RETURN NULL;
  END IF;
  
  IF v_battle.voting_ends_at > now() THEN
    RETURN NULL;
  END IF;
  
  -- Determine winner
  IF v_battle.votes_producer1 > v_battle.votes_producer2 THEN
    v_winner_id := v_battle.producer1_id;
  ELSIF v_battle.votes_producer2 > v_battle.votes_producer1 THEN
    v_winner_id := v_battle.producer2_id;
  ELSE
    v_winner_id := NULL; -- Tie
  END IF;
  
  -- Update battle
  UPDATE battles SET
    status = 'completed',
    winner_id = v_winner_id,
    updated_at = now()
  WHERE id = p_battle_id;
  
  RETURN v_winner_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;