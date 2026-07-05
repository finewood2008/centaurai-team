import { useMemo } from 'react';
import { useProvidersQuery } from './useModelProviderList';
import { getSupplementalImageModels } from '@/common/utils/imageModelAllowlist';

const useConfigModelListWithImage = () => {
  const { data } = useProvidersQuery();

  const modelListWithImage = useMemo(() => {
    return (data || []).map((platform) => {
      return {
        ...platform,
        models: [...platform.models, ...getSupplementalImageModels(platform)],
      };
    });
  }, [data]);

  return {
    modelListWithImage,
  };
};

export default useConfigModelListWithImage;
