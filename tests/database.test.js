import { dbHelpers } from '../server/database.js';
import bcrypt from 'bcryptjs';
import {
  createTestDatabase,
  createTestUser,
  createTestProject,
  cleanDatabase,
  expectValidUser,
  expectValidProject
} from './helpers.js';

describe('Database Operations', () => {
  let db;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  beforeEach(async () => {
    await cleanDatabase(db);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('User Operations', () => {
    describe('createUser', () => {
      it('should create a new user successfully', async () => {
        const userData = {
          name: 'John Doe',
          email: 'john@example.com',
          password: 'hashedpassword123'
        };

        const result = await dbHelpers.createUser(db, userData);
        
        expect(result).toHaveProperty('lastID');
        expect(typeof result.lastID).toBe('number');
        expect(result.lastID).toBeGreaterThan(0);

        // Verify user was created
        const createdUser = await db.get('SELECT * FROM users WHERE id = ?', result.lastID);
        expect(createdUser).toBeDefined();
        expect(createdUser.name).toBe(userData.name);
        expect(createdUser.email).toBe(userData.email);
        expect(createdUser.password).toBe(userData.password);
      });

      it('should enforce unique email constraint', async () => {
        const userData = {
          name: 'John Doe',
          email: 'john@example.com',
          password: 'hashedpassword123'
        };

        // Create first user
        await dbHelpers.createUser(db, userData);

        // Try to create second user with same email
        await expect(dbHelpers.createUser(db, userData))
          .rejects.toThrow();
      });
    });

    describe('getUserByEmail', () => {
      it('should return user by email', async () => {
        const testUser = await createTestUser(db, {
          email: 'test@example.com'
        });

        const foundUser = await dbHelpers.getUserByEmail(db, 'test@example.com');
        
        expect(foundUser).toBeDefined();
        expect(foundUser.id).toBe(testUser.id);
        expect(foundUser.email).toBe('test@example.com');
        expect(foundUser).toHaveProperty('password'); // Should include password
      });

      it('should return undefined for non-existent email', async () => {
        const foundUser = await dbHelpers.getUserByEmail(db, 'nonexistent@example.com');
        expect(foundUser).toBeUndefined();
      });

      // Phase 1: emails are normalized (trim + lowercase), so lookups are
      // case-insensitive (previously this test asserted case sensitivity).
      it('should be case insensitive for email', async () => {
        const testUser = await createTestUser(db, {
          email: 'test@example.com'
        });

        const foundUser = await dbHelpers.getUserByEmail(db, '  TEST@Example.COM ');
        expect(foundUser).toBeDefined();
        expect(foundUser.id).toBe(testUser.id);
      });

      it('should find legacy rows stored with capitals', async () => {
        const testUser = await createTestUser(db, {
          email: 'Legacy@Example.com'
        });

        const foundUser = await dbHelpers.getUserByEmail(db, 'legacy@example.com');
        expect(foundUser?.id).toBe(testUser.id);
      });
    });

    describe('getUserById', () => {
      it('should return user by ID without password', async () => {
        const testUser = await createTestUser(db);

        const foundUser = await dbHelpers.getUserById(db, testUser.id);
        
        expect(foundUser).toBeDefined();
        expectValidUser(foundUser);
        expect(foundUser.id).toBe(testUser.id);
        expect(foundUser).not.toHaveProperty('password'); // Should not include password
      });

      it('should return undefined for non-existent ID', async () => {
        const foundUser = await dbHelpers.getUserById(db, 99999);
        expect(foundUser).toBeUndefined();
      });
    });
  });

  describe('Project Operations', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await createTestUser(db);
    });

    describe('createProject', () => {
      it('should create a new project successfully', async () => {
        const projectData = {
          user_id: testUser.id,
          name: 'Test Project',
          description: 'A test project',
          nodes: [{ id: '1', type: 'input' }],
          edges: [{ id: 'e1', source: '1', target: '2' }],
          metadata: { version: '1.0' }
        };

        const result = await dbHelpers.createProject(db, projectData);
        
        expect(result).toHaveProperty('lastID');
        expect(typeof result.lastID).toBe('number');
        expect(result.lastID).toBeGreaterThan(0);

        // Verify project was created
        const createdProject = await db.get('SELECT * FROM projects WHERE id = ?', result.lastID);
        expect(createdProject).toBeDefined();
        expect(createdProject.name).toBe(projectData.name);
        expect(createdProject.user_id).toBe(testUser.id);
        expect(JSON.parse(createdProject.nodes)).toEqual(projectData.nodes);
        expect(JSON.parse(createdProject.edges)).toEqual(projectData.edges);
        expect(JSON.parse(createdProject.metadata)).toEqual(projectData.metadata);
      });

      it('should create project with minimal data', async () => {
        const projectData = {
          user_id: testUser.id,
          name: 'Minimal Project'
        };

        const result = await dbHelpers.createProject(db, projectData);
        
        const createdProject = await db.get('SELECT * FROM projects WHERE id = ?', result.lastID);
        expect(createdProject.name).toBe(projectData.name);
        expect(createdProject.description).toBeNull();
        expect(JSON.parse(createdProject.nodes)).toEqual([]);
        expect(JSON.parse(createdProject.edges)).toEqual([]);
        expect(JSON.parse(createdProject.metadata)).toEqual({});
      });

      it('should enforce foreign key constraint', async () => {
        const projectData = {
          user_id: 99999, // Non-existent user
          name: 'Test Project'
        };

        await expect(dbHelpers.createProject(db, projectData))
          .rejects.toThrow();
      });
    });

    describe('updateProject', () => {
      let testProject;

      beforeEach(async () => {
        testProject = await createTestProject(db, testUser.id);
      });

      it('should update project successfully', async () => {
        const updateData = {
          name: 'Updated Project',
          description: 'Updated description',
          nodes: [{ id: '1', type: 'updated' }],
          edges: [],
          metadata: { updated: true }
        };

        const result = await dbHelpers.updateProject(db, testProject.id, updateData);
        
        expect(result).toHaveProperty('changes');
        expect(result.changes).toBe(1);

        // Verify project was updated
        const updatedProject = await db.get('SELECT * FROM projects WHERE id = ?', testProject.id);
        expect(updatedProject.name).toBe(updateData.name);
        expect(updatedProject.description).toBe(updateData.description);
        expect(JSON.parse(updatedProject.nodes)).toEqual(updateData.nodes);
        expect(JSON.parse(updatedProject.edges)).toEqual(updateData.edges);
        expect(JSON.parse(updatedProject.metadata)).toEqual(updateData.metadata);
      });

      it('should return 0 changes for non-existent project', async () => {
        const updateData = {
          name: 'Updated Project',
          nodes: [],
          edges: [],
          metadata: {}
        };

        const result = await dbHelpers.updateProject(db, 99999, updateData);
        expect(result.changes).toBe(0);
      });
    });

    describe('getProjectById', () => {
      let testProject;

      beforeEach(async () => {
        testProject = await createTestProject(db, testUser.id);
      });

      it('should return project with parsed JSON fields', async () => {
        const foundProject = await dbHelpers.getProjectById(db, testProject.id);
        
        expect(foundProject).toBeDefined();
        expectValidProject(foundProject);
        expect(foundProject.id).toBe(testProject.id);
        expect(foundProject.user_id).toBe(testUser.id);
        expect(Array.isArray(foundProject.nodes)).toBe(true);
        expect(Array.isArray(foundProject.edges)).toBe(true);
        expect(typeof foundProject.metadata).toBe('object');
      });

      it('should return undefined for non-existent project', async () => {
        const foundProject = await dbHelpers.getProjectById(db, 99999);
        expect(foundProject).toBeUndefined();
      });
    });

    describe('getUserProjects', () => {
      it('should return user projects in descending order', async () => {
        // Create multiple projects with delays to ensure different timestamps
        const project1 = await createTestProject(db, testUser.id, { name: 'Project 1' });
        await new Promise(resolve => setTimeout(resolve, 100));
        const project2 = await createTestProject(db, testUser.id, { name: 'Project 2' });
        await new Promise(resolve => setTimeout(resolve, 100));
        const project3 = await createTestProject(db, testUser.id, { name: 'Project 3' });
        
        // Manually update timestamps to ensure proper ordering (disable trigger temporarily)
        await db.exec('DROP TRIGGER IF EXISTS update_projects_timestamp');
        await db.run('UPDATE projects SET updated_at = datetime(\'now\', \'-2 seconds\') WHERE id = ?', project1.id);
        await db.run('UPDATE projects SET updated_at = datetime(\'now\', \'-1 seconds\') WHERE id = ?', project2.id);
        await db.run('UPDATE projects SET updated_at = datetime(\'now\') WHERE id = ?', project3.id);
        // Recreate trigger
        await db.exec(`
          CREATE TRIGGER update_projects_timestamp 
          AFTER UPDATE ON projects
          BEGIN
            UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
          END;
        `);

        const projects = await dbHelpers.getUserProjects(db, testUser.id);
        
        expect(Array.isArray(projects)).toBe(true);
        expect(projects).toHaveLength(3);
        
        projects.forEach(project => {
          expectValidProject(project);
          expect(project.user_id).toBe(testUser.id);
        });



        // Should be ordered by updated_at DESC (most recent first)
        expect(projects[0].name).toBe('Project 3');
        expect(projects[1].name).toBe('Project 2');
        expect(projects[2].name).toBe('Project 1');
      });

      it('should return empty array for user with no projects', async () => {
        const projects = await dbHelpers.getUserProjects(db, testUser.id);
        
        expect(Array.isArray(projects)).toBe(true);
        expect(projects).toHaveLength(0);
      });

      it('should only return projects for specified user', async () => {
        const otherUser = await createTestUser(db, { email: 'other@example.com' });
        
        await createTestProject(db, testUser.id, { name: 'User 1 Project' });
        await createTestProject(db, otherUser.id, { name: 'User 2 Project' });

        const user1Projects = await dbHelpers.getUserProjects(db, testUser.id);
        const user2Projects = await dbHelpers.getUserProjects(db, otherUser.id);
        
        expect(user1Projects).toHaveLength(1);
        expect(user1Projects[0].name).toBe('User 1 Project');
        
        expect(user2Projects).toHaveLength(1);
        expect(user2Projects[0].name).toBe('User 2 Project');
      });
    });

    describe('deleteProject', () => {
      let testProject;

      beforeEach(async () => {
        testProject = await createTestProject(db, testUser.id);
      });

      it('should delete project successfully', async () => {
        const result = await dbHelpers.deleteProject(db, testProject.id);
        
        expect(result).toHaveProperty('changes');
        expect(result.changes).toBe(1);

        // Verify project was deleted
        const deletedProject = await db.get('SELECT * FROM projects WHERE id = ?', testProject.id);
        expect(deletedProject).toBeUndefined();
      });

      it('should return 0 changes for non-existent project', async () => {
        const result = await dbHelpers.deleteProject(db, 99999);
        expect(result.changes).toBe(0);
      });

      it('should cascade delete project versions', async () => {
        // Create a project version
        await dbHelpers.createProjectVersion(db, {
          project_id: testProject.id,
          version_number: 1,
          nodes: [],
          edges: [],
          metadata: {}
        });

        // Verify version exists
        const versionsBefore = await db.all('SELECT * FROM project_versions WHERE project_id = ?', testProject.id);
        expect(versionsBefore).toHaveLength(1);

        // Delete project
        await dbHelpers.deleteProject(db, testProject.id);

        // Verify versions were also deleted
        const versionsAfter = await db.all('SELECT * FROM project_versions WHERE project_id = ?', testProject.id);
        expect(versionsAfter).toHaveLength(0);
      });
    });
  });

  describe('Project Version Operations', () => {
    let testUser;
    let testProject;

    beforeEach(async () => {
      testUser = await createTestUser(db);
      testProject = await createTestProject(db, testUser.id);
    });

    describe('createProjectVersion', () => {
      it('should create project version successfully', async () => {
        const versionData = {
          project_id: testProject.id,
          version_number: 1,
          nodes: [{ id: '1', type: 'input' }],
          edges: [{ id: 'e1', source: '1', target: '2' }],
          metadata: { version: '1.0' }
        };

        const result = await dbHelpers.createProjectVersion(db, versionData);
        
        expect(result).toHaveProperty('lastID');
        expect(typeof result.lastID).toBe('number');

        // Verify version was created
        const createdVersion = await db.get('SELECT * FROM project_versions WHERE id = ?', result.lastID);
        expect(createdVersion).toBeDefined();
        expect(createdVersion.project_id).toBe(testProject.id);
        expect(createdVersion.version_number).toBe(1);
        expect(JSON.parse(createdVersion.nodes)).toEqual(versionData.nodes);
        expect(JSON.parse(createdVersion.edges)).toEqual(versionData.edges);
        expect(JSON.parse(createdVersion.metadata)).toEqual(versionData.metadata);
      });

      it('should enforce foreign key constraint', async () => {
        const versionData = {
          project_id: 99999, // Non-existent project
          version_number: 1,
          nodes: [],
          edges: [],
          metadata: {}
        };

        await expect(dbHelpers.createProjectVersion(db, versionData))
          .rejects.toThrow();
      });
    });

    describe('getProjectVersions', () => {
      it('should return project versions in descending order', async () => {
        // Create multiple versions
        await dbHelpers.createProjectVersion(db, {
          project_id: testProject.id,
          version_number: 1,
          nodes: [{ id: '1', data: { label: 'Version 1' } }],
          edges: [],
          metadata: { version: 1 }
        });

        await dbHelpers.createProjectVersion(db, {
          project_id: testProject.id,
          version_number: 2,
          nodes: [{ id: '1', data: { label: 'Version 2' } }],
          edges: [],
          metadata: { version: 2 }
        });

        await dbHelpers.createProjectVersion(db, {
          project_id: testProject.id,
          version_number: 3,
          nodes: [{ id: '1', data: { label: 'Version 3' } }],
          edges: [],
          metadata: { version: 3 }
        });

        const versions = await dbHelpers.getProjectVersions(db, testProject.id);
        
        expect(Array.isArray(versions)).toBe(true);
        expect(versions).toHaveLength(3);
        
        // Should be ordered by version_number DESC (highest first)
        expect(versions[0].version_number).toBe(3);
        expect(versions[1].version_number).toBe(2);
        expect(versions[2].version_number).toBe(1);

        versions.forEach(version => {
          expect(version).toHaveProperty('id');
          expect(version).toHaveProperty('project_id', testProject.id);
          expect(version).toHaveProperty('version_number');
          expect(Array.isArray(version.nodes)).toBe(true);
          expect(Array.isArray(version.edges)).toBe(true);
          expect(typeof version.metadata).toBe('object');
          expect(version).toHaveProperty('created_at');
        });
      });

      it('should return empty array for project with no versions', async () => {
        const versions = await dbHelpers.getProjectVersions(db, testProject.id);
        
        expect(Array.isArray(versions)).toBe(true);
        expect(versions).toHaveLength(0);
      });

      it('should only return versions for specified project', async () => {
        const otherProject = await createTestProject(db, testUser.id, { name: 'Other Project' });
        
        await dbHelpers.createProjectVersion(db, {
          project_id: testProject.id,
          version_number: 1,
          nodes: [],
          edges: [],
          metadata: {}
        });

        await dbHelpers.createProjectVersion(db, {
          project_id: otherProject.id,
          version_number: 1,
          nodes: [],
          edges: [],
          metadata: {}
        });

        const project1Versions = await dbHelpers.getProjectVersions(db, testProject.id);
        const project2Versions = await dbHelpers.getProjectVersions(db, otherProject.id);
        
        expect(project1Versions).toHaveLength(1);
        expect(project1Versions[0].project_id).toBe(testProject.id);
        
        expect(project2Versions).toHaveLength(1);
        expect(project2Versions[0].project_id).toBe(otherProject.id);
      });
    });
  });

  describe('Database Constraints and Relationships', () => {
    it('should cascade delete projects when user is deleted', async () => {
      const testUser = await createTestUser(db);
      const testProject = await createTestProject(db, testUser.id);

      // Verify project exists
      const projectBefore = await db.get('SELECT * FROM projects WHERE id = ?', testProject.id);
      expect(projectBefore).toBeDefined();

      // Delete user
      await db.run('DELETE FROM users WHERE id = ?', testUser.id);

      // Verify project was also deleted
      const projectAfter = await db.get('SELECT * FROM projects WHERE id = ?', testProject.id);
      expect(projectAfter).toBeUndefined();
    });

    it('should cascade delete project versions when project is deleted', async () => {
      const testUser = await createTestUser(db);
      const testProject = await createTestProject(db, testUser.id);
      
      // Create project version
      await dbHelpers.createProjectVersion(db, {
        project_id: testProject.id,
        version_number: 1,
        nodes: [],
        edges: [],
        metadata: {}
      });

      // Verify version exists
      const versionBefore = await db.all('SELECT * FROM project_versions WHERE project_id = ?', testProject.id);
      expect(versionBefore).toHaveLength(1);

      // Delete project
      await db.run('DELETE FROM projects WHERE id = ?', testProject.id);

      // Verify version was also deleted
      const versionAfter = await db.all('SELECT * FROM project_versions WHERE project_id = ?', testProject.id);
      expect(versionAfter).toHaveLength(0);
    });

    it('should update timestamps automatically', async () => {
      const testUser = await createTestUser(db);
      const testProject = await createTestProject(db, testUser.id);

      const originalProject = await db.get('SELECT * FROM projects WHERE id = ?', testProject.id);
      const originalUpdatedAt = originalProject.updated_at;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Update project
      await dbHelpers.updateProject(db, testProject.id, {
        name: 'Updated Name',
        description: null,
        nodes: [],
        edges: [],
        metadata: {}
      });

      const updatedProject = await db.get('SELECT * FROM projects WHERE id = ?', testProject.id);
      expect(updatedProject.updated_at).not.toBe(originalUpdatedAt);
    });
  });
});