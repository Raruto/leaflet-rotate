@unit
Feature: Bounded scenario execution
  Scenario: Setup and steps share one thirty-second deadline
    Then scenario deadlines reject late work without preventing cleanup
