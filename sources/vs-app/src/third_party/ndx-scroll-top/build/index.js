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

  module.run(function($transitions) {
    var doScroll, duration;
    duration = 500;
    doScroll = function() {
      if ($('html, body').scrollTop() > 0) {
        return $('html, body').animate({
          scrollTop: 0
        }, duration);
      }
    };
    return $transitions.onFinish({}, doScroll);
  });

}).call(this);

//# sourceMappingURL=index.js.map
