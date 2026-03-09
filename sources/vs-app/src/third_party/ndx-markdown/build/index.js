(function() {
  'use strict';
  var e, error, module;

  module = null;

  try {
    module = angular.module('ndx');
  } catch (error) {
    e = error;
    module = angular.module('ndx', []);
  }

  module.filter('markdown', function($sce) {
    return function(input, newLines) {
      if (newLines) {
        input = input.replace(/\n/g, '  \n');
      }
      return $sce.trustAs('html', marked(input));
    };
  });

}).call(this);

//# sourceMappingURL=index.js.map
