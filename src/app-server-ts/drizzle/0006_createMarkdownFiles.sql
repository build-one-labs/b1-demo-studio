-- Create markdown_files table for TipTap editor sample
CREATE TABLE IF NOT EXISTS "markdown_files" (
  "id" SERIAL PRIMARY KEY NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "sample_tip_tap" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Insert sample data
INSERT INTO "markdown_files" ("title", "sample_tip_tap") VALUES
(
  'Welcome Document',
  '<h1>Welcome to TipTap!</h1><p>This is a <strong>rich text editor</strong> powered by TipTap. Try the following features:</p><ul><li>Text formatting (bold, italic, underline)</li><li>Headings (H1, H2, H3)</li><li>Lists (bulleted and numbered)</li><li>Links and images</li><li>Tables and code blocks</li></ul><p>Start editing to see it in action!</p>'
),
(
  'Meeting Notes',
  '<h2>Project Planning Meeting</h2><p><em>Date: January 2025</em></p><h3>Attendees</h3><ul><li>John Doe - Project Manager</li><li>Jane Smith - Developer</li><li>Bob Johnson - Designer</li></ul><h3>Action Items</h3><ol><li>Review current sprint progress</li><li>Plan next sprint goals</li><li>Update documentation</li></ol><blockquote>Next meeting scheduled for next Monday.</blockquote>'
),
(
  'Technical Documentation',
  '<h1>API Documentation</h1><p>This document describes the REST API endpoints.</p><h2>Authentication</h2><p>All requests require a valid <code>Bearer</code> token in the Authorization header.</p><pre><code>Authorization: Bearer your-token-here</code></pre><h2>Endpoints</h2><h3>GET /api/users</h3><p>Returns a list of all users.</p><h3>POST /api/users</h3><p>Creates a new user. Request body should contain:</p><ul><li><strong>name</strong> - User''s full name</li><li><strong>email</strong> - User''s email address</li></ul>'
);
