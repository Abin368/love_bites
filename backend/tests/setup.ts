// Test setup fixture
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

beforeAll(() => {
  // Silence logs during testing unless explicitly debugging
});

afterAll(() => {
  // Clean up any open handles
});
