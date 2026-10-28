// renderStill 打包入口:bundle() 以此文件为 entry,注册全部模板 Composition。
// 模板集必须与 src/registry.ts 的 TEMPLATES 键一致(导出接 WP-2 模板注册表锚点)。
import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { Cover, type CoverProps } from './Cover'
import { CoverPortrait } from './CoverPortrait'
import { ProductCover, type ProductCoverProps } from './ProductCover'
import { ProductCoverPortrait } from './ProductCoverPortrait'
import { VideoCover, type VideoCoverProps } from './VideoCover'
import { VideoCoverPortrait } from './VideoCoverPortrait'

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="cover"
      component={Cover as React.FC<CoverProps>}
      width={1280}
      height={720}
      fps={30}
      durationInFrames={1}
      defaultProps={{ title: '标题', subtitle: '副标题', badge: '角标' }}
    />
    <Composition
      id="cover-portrait"
      component={CoverPortrait as React.FC<CoverProps>}
      width={1080}
      height={1440}
      fps={30}
      durationInFrames={1}
      defaultProps={{ title: '标题', subtitle: '副标题', badge: '角标' }}
    />
    <Composition
      id="product"
      component={ProductCover as React.FC<ProductCoverProps>}
      width={1280}
      height={720}
      fps={30}
      durationInFrames={1}
      defaultProps={{
        brand: '品牌', title: '产品名', subtitle: '副题', badge: '角标',
        features: ['卖点一', '卖点二', '卖点三'], image: 'mouse.jpg',
      }}
    />
    <Composition
      id="product-portrait"
      component={ProductCoverPortrait as React.FC<ProductCoverProps>}
      width={1080}
      height={1440}
      fps={30}
      durationInFrames={1}
      defaultProps={{
        brand: '品牌', title: '产品名', subtitle: '副题', badge: '角标',
        features: ['卖点一', '卖点二'], image: 'mouse.jpg',
      }}
    />
    <Composition
      id="video"
      component={VideoCover as React.FC<VideoCoverProps>}
      width={1280}
      height={720}
      fps={30}
      durationInFrames={1}
      defaultProps={{ hookLines: ['钩子一', '钩子二'], subTag: '栏目', brand: '品牌', image: 'mouse.jpg' }}
    />
    <Composition
      id="video-portrait"
      component={VideoCoverPortrait as React.FC<VideoCoverProps>}
      width={1080}
      height={1440}
      fps={30}
      durationInFrames={1}
      defaultProps={{ hookLines: ['钩子一', '钩子二'], subTag: '栏目', brand: '品牌', image: 'mouse.jpg' }}
    />
  </>
)

registerRoot(RemotionRoot)
