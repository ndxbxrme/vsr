(function() {
  angular.module('multi-check', []).directive('multiCheck', function() {
    return {
      restrict: 'EA',
      require: 'ngModel',
      transclude: true,
      replace: true,
      scope: {
        ngModel: '='
      },
      template: '<div class="multi-check"><ng-transclude></ng-transclude></div>',
      link: function(scope, elem, attrs, ngModel) {
        scope.$watch('ngModel', function(val) {
          if (!val) {
            val = [];
          }
          if (!angular.isArray(val)) {
            val = [val + ''];
          }
          scope.model = val;
          ngModel.$setPristine();
        }, true);
        return scope.updateModel = function(id, value) {
          if (!value) {
            if (scope.model.indexOf(id) !== -1) {
              scope.model.splice(scope.model.indexOf(id), 1);
            } else {
              scope.model.splice(scope.model.indexOf(parseInt(id)), 1);
            }
          } else {
            scope.model.push(id);
          }
          ngModel.$setViewValue(scope.model);
          ngModel.$setDirty();
        };
      }
    };
  }).directive('multiCheckItem', function() {
    return {
      restrict: 'EA',
      transclude: true,
      replace: true,
      template: '<div class="check-item"><input type="checkbox" id="{{id}}" ng-model="value" ng-change="change()" ><label for="{{id}}"><ng-transclude></ng-transclude></label></div>',
      link: function(scope, elem, attrs) {
        scope.id = 'ndxcbi' + attrs.value + Math.floor(Math.random() * 999999);
        scope.$watch(function() {
          return scope.$parent.$parent.model;
        }, function(n) {
          if (n) {
            return scope.value = n.indexOf(attrs.value) !== -1 || n.indexOf(parseInt(attrs.value)) !== -1;
          }
        }, true);
        return scope.change = function() {
          return scope.$parent.$parent.updateModel(attrs.value, scope.value);
        };
      }
    };
  });

}).call(this);
