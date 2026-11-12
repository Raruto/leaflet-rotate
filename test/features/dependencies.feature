@unit
Feature: Browser dependencies are prepared before scenarios
  Scenario: Every run refreshes dependencies and fails explicitly when downloads fail
    Then browser dependencies are downloaded again without falling back to old files
