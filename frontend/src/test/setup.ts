import '@testing-library/jest-dom';

// Polyfill scrollIntoView for jsdom
Element.prototype.scrollIntoView = () => {};
