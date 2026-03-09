var heic2any = require('heic2any');

(function() {
  angular.module('vs-maintenance-leads').controller('maintenance_leadsLightboxCtrl', function($scope, data, ndxModalInstance) {
    $scope.imgIndex = data;
    $scope.converting = false;

    $scope.isVideo = function(url) {
      if (!url) return false;
      const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];
      const lowerUrl = url.toLowerCase();
      return videoExtensions.some(ext => lowerUrl.includes(ext));
    };

    const isHeic = function(url) {
      if (!url) return false;
      const lower = url.toLowerCase();
      if (lower.includes('.heic') || lower.includes('.heif')) return true;
      // URL may be a base64-encoded download token — decode and check filename/path inside
      try {
        const token = url.split('/download/')[1];
        if (token) {
          const decoded = JSON.parse(atob(token.split('?')[0]));
          const name = ((decoded.filename || '') + (decoded.path || '')).toLowerCase();
          return name.includes('.heic') || name.includes('.heif');
        }
      } catch (e) {}
      return false;
    };

    const resolveImageSrc = function(url) {
      if (!isHeic(url)) {
        $scope.imgSrc = url;
        return;
      }
      $scope.converting = true;
      $scope.imgSrc = null;
      fetch(url)
        .then(res => res.blob())
        .then(blob => heic2any({ blob, toType: 'image/jpeg', quality: 0.85 }))
        .then(converted => {
          $scope.$apply(() => {
            $scope.imgSrc = URL.createObjectURL(converted);
            $scope.converting = false;
          });
        })
        .catch(() => {
          $scope.$apply(() => {
            $scope.imgSrc = url;
            $scope.converting = false;
          });
        });
    };

    $scope.selectImage = function(url) {
      resolveImageSrc(url);
    };

    $scope.cancel = function() {
      return ndxModalInstance.dismiss();
    };

    resolveImageSrc(data[0].URL);
  });

}).call(this);
