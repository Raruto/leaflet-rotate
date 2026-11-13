@smoke
Feature: Example smoke tests
  @unit
  Scenario: The examples list is complete
    Then all HTML examples are listed

  Scenario: Development URLs are rewritten only in served HTML
    Then development pages rewrite CDN URLs without changing files

  Scenario Outline: An example loads without browser errors
    Then the example "<example>" loads without browser errors

    Examples:
      | example |
      | leaflet-rotate.html |
