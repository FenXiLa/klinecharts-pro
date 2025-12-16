/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createSignal, createEffect, onMount, Show, onCleanup, startTransition, Component } from 'solid-js'

import {
  init, dispose, utils, Nullable, Chart, OverlayMode, Styles,
  PaneOptions, Indicator, DomPosition, FormatDateType
} from 'klinecharts'

import lodashSet from 'lodash/set'
import lodashClone from 'lodash/cloneDeep'

import { SelectDataSourceItem, Loading } from './component'

import {
  PeriodBar, DrawingBar, IndicatorModal, TimezoneModal, SettingModal,
  ScreenshotModal, IndicatorSettingModal, SymbolSearchModal
} from './widget'

import { translateTimezone } from './widget/timezone-modal/data'

import { SymbolInfo, Period, ChartProOptions, ChartPro } from './types'

export interface ChartProComponentProps extends Required<Omit<ChartProOptions, 'container'>> {
  ref: (chart: ChartPro) => void
}

interface PrevSymbolPeriod {
  symbol: SymbolInfo
  period: Period
}

function createIndicator (widget: Nullable<Chart>, indicatorName: string, isStack?: boolean, paneOptions?: PaneOptions): Nullable<string> {
  // gap 属性在 V10 中已删除，使用 axis 配置代替
  return widget?.createIndicator({
    name: indicatorName,
    // @ts-expect-error - using old API format for compatibility
    createTooltipDataSource: ({ indicator, defaultStyles }: any) => {
      // 安全检查：确保 defaultStyles 和 tooltip 存在
      if (!defaultStyles || !defaultStyles.tooltip || !defaultStyles.tooltip.features) {
        // 如果 defaultStyles 未准备好，返回空 features
        return { features: [] }
      }
      
      const features = []
      const tooltipFeatures = defaultStyles.tooltip.features
      
      if (indicator.visible) {
        // 安全地访问数组元素
        if (tooltipFeatures[1]) features.push(tooltipFeatures[1])
        if (tooltipFeatures[2]) features.push(tooltipFeatures[2])
        if (tooltipFeatures[3]) features.push(tooltipFeatures[3])
      } else {
        if (tooltipFeatures[0]) features.push(tooltipFeatures[0])
        if (tooltipFeatures[2]) features.push(tooltipFeatures[2])
        if (tooltipFeatures[3]) features.push(tooltipFeatures[3])
      }
      return { features }
    }
  }, isStack, paneOptions) ?? null
}

const ChartProComponent: Component<ChartProComponentProps> = props => {
  let widgetRef: HTMLDivElement | undefined = undefined
  let widget: Nullable<Chart> = null

  let priceUnitDom: HTMLElement

  let loading = false

  const [theme, setTheme] = createSignal(props.theme)
  const [styles, setStyles] = createSignal(props.styles)
  const [locale, setLocale] = createSignal(props.locale)

  const [symbol, setSymbol] = createSignal(props.symbol)
  const [period, setPeriod] = createSignal(props.period)
  
  // 包装 setPeriod 以添加调试信息
  const setPeriodWithLog = (newPeriod: Period) => {
    const oldPeriod = period()
    console.log('[ChartPro] setPeriod 被调用:', {
      oldPeriod,
      newPeriod,
      isEqual: oldPeriod.text === newPeriod.text
    })
    setPeriod(newPeriod)
    console.log('[ChartPro] setPeriod 执行后，当前 period:', period())
  }
  const [indicatorModalVisible, setIndicatorModalVisible] = createSignal(false)
  const [mainIndicators, setMainIndicators] = createSignal([...(props.mainIndicators!)])
  const [subIndicators, setSubIndicators] = createSignal({})

  const [timezoneModalVisible, setTimezoneModalVisible] = createSignal(false)
  const [timezone, setTimezone] = createSignal<SelectDataSourceItem>({ key: props.timezone, text: translateTimezone(props.timezone, props.locale) })

  const [settingModalVisible, setSettingModalVisible] = createSignal(false)
  const [widgetDefaultStyles, setWidgetDefaultStyles] = createSignal<Styles>()

  const [screenshotUrl, setScreenshotUrl] = createSignal('')

  const [drawingBarVisible, setDrawingBarVisible] = createSignal(props.drawingBarVisible)

  const [symbolSearchModalVisible, setSymbolSearchModalVisible] = createSignal(false)

  const [loadingVisible, setLoadingVisible] = createSignal(false)

  const [indicatorSettingModalParams, setIndicatorSettingModalParams] = createSignal({
    visible: false, indicatorName: '', paneId: '', calcParams: [] as Array<any>
  })

  props.ref({
    setTheme,
    getTheme: () => theme(),
    setStyles,
    getStyles: () => widget!.getStyles(),
    setLocale,
    getLocale: () => locale(),
    setTimezone: (timezone: string) => { setTimezone({ key: timezone, text: translateTimezone(props.timezone, locale()) }) },
    getTimezone: () => timezone().key,
    setSymbol,
    getSymbol: () => symbol(),
    setPeriod: setPeriodWithLog,
    getPeriod: () => period()
  })

  const documentResize = () => {
    widget?.resize()
  }

  const adjustFromTo = (period: Period, toTimestamp: number, count: number) => {
    let to = toTimestamp
    let from = to
    switch (period.timespan) {
      case 'minute': {
        to = to - (to % (60 * 1000))
        from = to - count * period.multiplier * 60 * 1000
        break
      }
      case 'hour': {
        to = to - (to % (60 * 60 * 1000))
        from = to - count * period.multiplier * 60 * 60 * 1000
        break
      }
      case 'day': {
        to = to - (to % (60 * 60 * 1000))
        from = to - count * period.multiplier * 24 * 60 * 60 * 1000
        break
      }
      case 'week': {
        const date = new Date(to)
        const week = date.getDay()
        const dif = week === 0 ? 6 : week - 1
        to = to - dif * 60 * 60 * 24
        const newDate = new Date(to)
        to = new Date(`${newDate.getFullYear()}-${newDate.getMonth() + 1}-${newDate.getDate()}`).getTime()
        from = count * period.multiplier * 7 * 24 * 60 * 60 * 1000
        break
      }
      case 'month': {
        const date = new Date(to)
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        to = new Date(`${year}-${month}-01`).getTime()
        from = count * period.multiplier * 30 * 24 * 60 * 60 * 1000
        const fromDate = new Date(from)
        from = new Date(`${fromDate.getFullYear()}-${fromDate.getMonth() + 1}-01`).getTime()
        break
      }
      case 'year': {
        const date = new Date(to)
        const year = date.getFullYear()
        to = new Date(`${year}-01-01`).getTime()
        from = count * period.multiplier * 365 * 24 * 60 * 60 * 1000
        const fromDate = new Date(from)
        from = new Date(`${fromDate.getFullYear()}-01-01`).getTime()
        break
      }
    }
    return [from, to]
  }

  onMount(() => {
    window.addEventListener('resize', documentResize)
    widget = init(widgetRef!, {
      formatter: {
        formatDate: (params: { dateTimeFormat: Intl.DateTimeFormat, timestamp: number, template: string, type: FormatDateType }) => {
          const { dateTimeFormat, timestamp, template, type } = params
          const p = period()
          const typeStr = String(type) as string
          const isXAxis = typeStr === 'xAxis'
          switch (p.timespan) {
            case 'minute': {
              if (isXAxis) {
                return utils.formatDate(dateTimeFormat, timestamp, 'HH:mm')
              }
              return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD HH:mm')
            }
            case 'hour': {
              if (isXAxis) {
                return utils.formatDate(dateTimeFormat, timestamp, 'MM-DD HH:mm')
              }
              return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD HH:mm')
            }
            case 'day':
            case 'week': return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD')
            case 'month': {
              if (isXAxis) {
                return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM')
              }
              return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD')
            }
            case 'year': {
              if (isXAxis) {
                return utils.formatDate(dateTimeFormat, timestamp, 'YYYY')
              }
              return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD')
            }
          }
          return utils.formatDate(dateTimeFormat, timestamp, 'YYYY-MM-DD HH:mm')
        }
      } as any
    } as any)

    if (widget) {
      const watermarkContainer = widget.getDom('candle_pane', 'main' as DomPosition)
      if (watermarkContainer) {
        let watermark = document.createElement('div')
        watermark.className = 'klinecharts-pro-watermark'
        if (utils.isString(props.watermark)) {
          const str = (props.watermark as string).replace(/(^\s*)|(\s*$)/g, '')
          watermark.innerHTML = str
        } else {
          watermark.appendChild(props.watermark as Node)
        }
        watermarkContainer.appendChild(watermark)
      }

      const priceUnitContainer = widget.getDom('candle_pane', 'yAxis' as DomPosition)
      priceUnitDom = document.createElement('span')
      priceUnitDom.className = 'klinecharts-pro-price-unit'
      priceUnitContainer?.appendChild(priceUnitDom)
    }

    mainIndicators().forEach(indicator => {
      createIndicator(widget, indicator, true, { id: 'candle_pane' })
    })
    const subIndicatorMap = {}
    props.subIndicators!.forEach(indicator => {
      const paneId = createIndicator(widget, indicator, true)
      if (paneId) {
        // @ts-expect-error
        subIndicatorMap[indicator] = paneId
      }
    })
    setSubIndicators(subIndicatorMap)
    
    // Set up DataLoader for V10 API
    if (widget) {
      (widget as any).setDataLoader({
        getBars: async (params: any) => {
          const { type, timestamp, symbol: s, period: p, callback } = params
          console.log('[DataLoader] getBars called:', { type, timestamp, symbol: s?.ticker, period: p })
          console.log('[DataLoader] 设置 loading = true')
          loading = true
          try {
            if (type === 'init' || type === 'forward') {
              // Load initial data or forward data
              const [from, to] = adjustFromTo(p, timestamp ?? new Date().getTime(), 500)
              console.log('[DataLoader] Loading data:', { from: new Date(from), to: new Date(to), symbol: s?.ticker, period: p })
              const kLineDataList = await props.datafeed.getHistoryKLineData(s, p, from, to)
              console.log('[DataLoader] Data loaded:', kLineDataList.length, 'bars')
              callback(kLineDataList, kLineDataList.length > 0)
            } else if (type === 'backward') {
              // Load more historical data
              const [to] = adjustFromTo(p, timestamp ?? new Date().getTime(), 1)
              const [from] = adjustFromTo(p, to, 500)
              console.log('[DataLoader] Loading backward data:', { from: new Date(from), to: new Date(to), symbol: s?.ticker, period: p })
              const kLineDataList = await props.datafeed.getHistoryKLineData(s, p, from, to)
              console.log('[DataLoader] Backward data loaded:', kLineDataList.length, 'bars')
              callback(kLineDataList, kLineDataList.length > 0)
            } else {
              console.log('[DataLoader] Unknown type:', type)
              callback([], false)
            }
          } catch (error) {
            console.error('[DataLoader] Error loading data:', error)
            callback([], false)
          } finally {
            console.log('[DataLoader] 设置 loading = false')
            loading = false
          }
        },
        subscribeBar: (params: any) => {
          const { symbol: s, period: p, callback } = params
          console.log('[DataLoader] subscribeBar:', { symbol: s?.ticker, period: p })
          props.datafeed.subscribe(s, p, callback)
        },
        unsubscribeBar: (params: any) => {
          const { symbol: s, period: p } = params
          console.log('[DataLoader] unsubscribeBar:', { symbol: s?.ticker, period: p })
          props.datafeed.unsubscribe(s, p)
        }
      })
      
      // Set initial symbol and period to trigger data loading
      const initialSymbol = symbol()
      const initialPeriod = period()
      if (initialSymbol) {
        console.log('[ChartPro] Setting initial symbol:', initialSymbol)
        widget.setSymbol(initialSymbol as any)
      }
      if (initialPeriod) {
        console.log('[ChartPro] Setting initial period:', initialPeriod)
        widget.setPeriod(initialPeriod as any)
      }
    }
    
    widget?.subscribeAction('onIndicatorTooltipFeatureClick' as any, (data: any) => {
      if (data.indicatorName) {
        switch (data.featureId) {
          case 'visible': {
            widget?.overrideIndicator({ name: data.indicatorName, visible: true, paneId: data.paneId })
            break
          }
          case 'invisible': {
            widget?.overrideIndicator({ name: data.indicatorName, visible: false, paneId: data.paneId })
            break
          }
          case 'setting': {
            const indicators = widget?.getIndicators({ paneId: data.paneId, name: data.indicatorName })
            const indicator = indicators?.[0] as Indicator
            if (indicator) {
              setIndicatorSettingModalParams({
                visible: true, indicatorName: data.indicatorName, paneId: data.paneId, calcParams: indicator.calcParams
              })
            }
            break
          }
          case 'close': {
            if (data.paneId === 'candle_pane') {
              const newMainIndicators = [...mainIndicators()]
              widget?.removeIndicator({ paneId: 'candle_pane', name: data.indicatorName })
              newMainIndicators.splice(newMainIndicators.indexOf(data.indicatorName), 1)
              setMainIndicators(newMainIndicators)
            } else {
              const newIndicators = { ...subIndicators() }
              widget?.removeIndicator({ paneId: data.paneId, name: data.indicatorName })
              // @ts-expect-error
              delete newIndicators[data.indicatorName]
              setSubIndicators(newIndicators)
            }
          }
        }
      }
    })
  })

  onCleanup(() => {
    window.removeEventListener('resize', documentResize)
    dispose(widgetRef!)
  })

  createEffect(() => {
    const s = symbol()
    if (s?.priceCurrency) {
      priceUnitDom.innerHTML = s?.priceCurrency.toLocaleUpperCase()
      priceUnitDom.style.display = 'flex'
    } else {
      priceUnitDom.style.display = 'none'
    }
    // Use setSymbol instead of setPriceVolumePrecision in V10
    if (s && widget) {
      widget.setSymbol(s as any)
    }
  })

  createEffect((prev?: PrevSymbolPeriod) => {
    const s = symbol()
    const p = period()
    
    console.log('[ChartPro] createEffect 触发:', { 
      loading, 
      hasWidget: !!widget, 
      currentSymbol: s, 
      currentPeriod: p,
      prevSymbol: prev?.symbol,
      prevPeriod: prev?.period
    })
    
    if (!loading && widget) {
      if (prev) {
        console.log('[ChartPro] 取消订阅之前的周期:', prev.symbol, prev.period)
        props.datafeed.unsubscribe(prev.symbol, prev.period)
      }
      
      // Update symbol and period to trigger data loading via DataLoader
      if (s) {
        const symbolChanged = !prev || prev.symbol.ticker !== s.ticker
        if (symbolChanged) {
          console.log('[ChartPro] Symbol 变化，更新:', s)
          widget.setSymbol(s as any)
        } else {
          console.log('[ChartPro] Symbol 未变化，跳过更新')
        }
      }
      if (p) {
        const periodChanged = !prev || prev.period.text !== p.text
        if (periodChanged) {
          console.log('[ChartPro] Period 变化，更新:', p, '之前:', prev?.period)
          widget.setPeriod(p as any)
        } else {
          console.log('[ChartPro] Period 未变化，跳过更新')
        }
      }
      
      loading = false
      setLoadingVisible(false)
      console.log('[ChartPro] createEffect 完成，返回新的 symbol 和 period')
      return { symbol: s, period: p }
    } else {
      console.log('[ChartPro] createEffect 跳过执行:', { 
        loading, 
        hasWidget: !!widget,
        reason: loading ? 'loading=true' : 'widget不存在'
      })
    }
    return prev
  })

  createEffect(() => {
    const t = theme()
    widget?.setStyles(t)
    const color = t === 'dark' ? '#929AA5' : '#76808F'
    widget?.setStyles({
      indicator: {
        tooltip: {
          features: [
            {
              id: 'visible',
              position: 'middle' as any,
              marginLeft: 8,
              marginTop: 7,
              marginRight: 0,
              marginBottom: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              type: 'icon_font' as any,
              content: { family: 'icomoon', code: '\ue903' } as any,
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)',
              borderRadius: 0
            },
            {
              id: 'invisible',
              position: 'middle' as any,
              marginLeft: 8,
              marginTop: 7,
              marginRight: 0,
              marginBottom: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              type: 'icon_font' as any,
              content: { family: 'icomoon', code: '\ue901' } as any,
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)',
              borderRadius: 0
            },
            {
              id: 'setting',
              position: 'middle' as any,
              marginLeft: 6,
              marginTop: 7,
              marginBottom: 0,
              marginRight: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              type: 'icon_font' as any,
              content: { family: 'icomoon', code: '\ue902' } as any,
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)',
              borderRadius: 0
            },
            {
              id: 'close',
              position: 'middle' as any,
              marginLeft: 6,
              marginTop: 7,
              marginRight: 0,
              marginBottom: 0,
              paddingLeft: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              type: 'icon_font' as any,
              content: { family: 'icomoon', code: '\ue900' } as any,
              size: 14,
              color: color,
              activeColor: color,
              backgroundColor: 'transparent',
              activeBackgroundColor: 'rgba(22, 119, 255, 0.15)',
              borderRadius: 0
            }
          ]
        }
      }
    })
  })

  createEffect(() => {
    widget?.setLocale(locale())
  })

  createEffect(() => {
    widget?.setTimezone(timezone().key)
  })

  createEffect(() => {
    if (styles()) {
      widget?.setStyles(styles())
      setWidgetDefaultStyles(lodashClone(widget!.getStyles()))
    }
  })

  return (
    <>
      <i class="icon-close klinecharts-pro-load-icon"/>
      <Show when={symbolSearchModalVisible()}>
        <SymbolSearchModal
          locale={props.locale}
          datafeed={props.datafeed}
          onSymbolSelected={symbol => { setSymbol(symbol) }}
          onClose={() => { setSymbolSearchModalVisible(false) }}/>
      </Show>
      <Show when={indicatorModalVisible()}>
        <IndicatorModal
          locale={props.locale}
          mainIndicators={mainIndicators()}
          subIndicators={subIndicators()}
          onClose={() => { setIndicatorModalVisible(false) }}
          onMainIndicatorChange={data => {
            const newMainIndicators = [...mainIndicators()]
            if (data.added) {
              createIndicator(widget, data.name, true, { id: 'candle_pane' })
              newMainIndicators.push(data.name)
            } else {
              widget?.removeIndicator({ paneId: 'candle_pane', name: data.name })
              newMainIndicators.splice(newMainIndicators.indexOf(data.name), 1)
            }
            setMainIndicators(newMainIndicators)
          }}
          onSubIndicatorChange={data => {
            const newSubIndicators = { ...subIndicators() }
            if (data.added) {
              const paneId = createIndicator(widget, data.name)
              if (paneId) {
                // @ts-expect-error
                newSubIndicators[data.name] = paneId
              }
            } else {
              if (data.paneId) {
                widget?.removeIndicator({ paneId: data.paneId, name: data.name })
                // @ts-expect-error
                delete newSubIndicators[data.name]
              }
            }
            setSubIndicators(newSubIndicators)
          }}/>
      </Show>
      <Show when={timezoneModalVisible()}>
        <TimezoneModal
          locale={props.locale}
          timezone={timezone()}
          onClose={() => { setTimezoneModalVisible(false) }}
          onConfirm={setTimezone}
        />
      </Show>
      <Show when={settingModalVisible()}>
        <SettingModal
          locale={props.locale}
          currentStyles={utils.clone(widget!.getStyles())}
          onClose={() => { setSettingModalVisible(false) }}
          onChange={style => {
            widget?.setStyles(style)
          }}
          onRestoreDefault={(options: SelectDataSourceItem[]) => {
            const style = {}
            options.forEach(option => {
              const key = option.key
              lodashSet(style, key, utils.formatValue(widgetDefaultStyles(), key))
            })
            widget?.setStyles(style)
          }}
        />
      </Show>
      <Show when={screenshotUrl().length > 0}>
        <ScreenshotModal
          locale={props.locale}
          url={screenshotUrl()}
          onClose={() => { setScreenshotUrl('') }}
        />
      </Show>
      <Show when={indicatorSettingModalParams().visible}>
        <IndicatorSettingModal
          locale={props.locale}
          params={indicatorSettingModalParams()}
          onClose={() => { setIndicatorSettingModalParams({ visible: false, indicatorName: '', paneId: '', calcParams: [] }) }}
          onConfirm={(params)=> {
            const modalParams = indicatorSettingModalParams()
            widget?.overrideIndicator({ name: modalParams.indicatorName, calcParams: params, paneId: modalParams.paneId })
          }}
        />
      </Show>
      <PeriodBar
        locale={props.locale}
        symbol={symbol()}
        spread={drawingBarVisible()}
        period={period()}
        periods={props.periods}
        onMenuClick={async () => {
          try {
            await startTransition(() => setDrawingBarVisible(!drawingBarVisible()))
            widget?.resize()
          } catch (e) {}    
        }}
        onSymbolClick={() => { setSymbolSearchModalVisible(!symbolSearchModalVisible()) }}
        onPeriodChange={setPeriodWithLog}
        onIndicatorClick={() => { setIndicatorModalVisible((visible => !visible)) }}
        onTimezoneClick={() => { setTimezoneModalVisible((visible => !visible)) }}
        onSettingClick={() => { setSettingModalVisible((visible => !visible)) }}
        onScreenshotClick={() => {
          if (widget) {
            const url = widget.getConvertPictureUrl(true, 'jpeg', props.theme === 'dark' ? '#151517' : '#ffffff')
            setScreenshotUrl(url)
          }
        }}
      />
      <div
        class="klinecharts-pro-content">
        <Show when={loadingVisible()}>
          <Loading/>
        </Show>
        <Show when={drawingBarVisible()}>
          <DrawingBar
            locale={props.locale}
            onDrawingItemClick={overlay => { widget?.createOverlay(overlay) }}
            onModeChange={mode => { widget?.overrideOverlay({ mode: mode as OverlayMode }) }}
            onLockChange={lock => { widget?.overrideOverlay({ lock }) }}
            onVisibleChange={visible => { widget?.overrideOverlay({ visible }) }}
            onRemoveClick={(groupId) => { widget?.removeOverlay({ groupId }) }}/>
        </Show>
        <div
          ref={widgetRef}
          class='klinecharts-pro-widget'
          data-drawing-bar-visible={drawingBarVisible()}/>
      </div>
    </>
  )
}

export default ChartProComponent