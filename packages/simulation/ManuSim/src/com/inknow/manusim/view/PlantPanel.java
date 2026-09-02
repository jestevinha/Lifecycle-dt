package com.inknow.manusim.view;

import java.awt.Font;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.util.Vector;

import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JSlider;
import javax.swing.SwingConstants;
import javax.swing.event.ChangeEvent;
import javax.swing.event.ChangeListener;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.model.Actor;
import com.inknow.manusim.model.DayTime;
import com.inknow.manusim.model.Unit;
import com.inknow.manusim.model.Weather;
import com.inknow.manusim.model.Workarea;

public class PlantPanel extends javax.swing.JPanel implements ChangeListener, ActionListener {
	
	private JPanel skyLeft;
	private JPanel skyTop;
	private JPanel skyRight;
	private JPanel skyBottom;
	private JLabel clockLabel;
	private JLabel weekDayLabel;
	private JLabel auditDayLabel;
	private JLabel ambTempLabel;
	private JLabel weatherLabel;
	private JLabel logoLabel;
	//
	private JButton exitButton;
	private JButton startButton;
	private JButton resetButton;
	private JButton dayNightButton;
	//
	private JSlider setpointRateSlider;
	//
	private JLabel totalPowerLabel;
	private JLabel totalEnergyLabel;
	private JLabel totalCostLabel;
	private JLabel productEnergyLabel;
	private JLabel productCostLabel;
	private JLabel numberAccidentsLabel;
	//
	private ViewFrame parent;
	private Vector<WorkareaPane> workareaPanes;
	private Vector<UnitLabel> unitLabels;
	private Vector<Location> locations;
	private Vector<ActorLabel> actorLabels;
	
	private Boolean dayNight;
	
	//
	private static final long serialVersionUID = 1L;
	
	// constructors
	
	public PlantPanel(ViewFrame parent) {
		super();
		this.parent = parent;
		this.dayNight = true;
		//
		this.defineWorkareaPanes();
		this.defineUnitLabels();
		this.defineLocations();
		this.defineActorLabels();
		//
		this.initComponents();
		
		Vector<Actor> actors = this.parent.getParent().getSimulator().getPlant().getActors();
		for( int i = 0; i < actors.size(); i++ ) {
			int locationIndex = actors.get(i).getLocationIndex();
			this.actorLabels.get(i).goToWorkarea( this.locations.get( locationIndex ), actors.get(i).getStatus() );
		}
	}

	// other methods
	
	public void updateView() {
		// display the colors of the sky, clock and other global data
		this.displaySkyItems();
		//
		// update workareaPanes 
		for( int i = 0; i < workareaPanes.size(); i++ ) {
			Workarea auxWorkarea = this.parent.getParent().getSimulator().getPlant().getWorkareas().get(i);
			this.workareaPanes.get(i).setStatus( auxWorkarea.getStatus() );
			this.workareaPanes.get(i).getDisplayPanel().updateDisplayPanel( auxWorkarea );
		}
		//
		// update actors
		Vector<Actor> actors = this.parent.getParent().getSimulator().getPlant().getActors();
		for( int i = 0; i < actors.size(); i++ ) {
			int locationIndex = actors.get(i).getLocationIndex();
			this.actorLabels.get(i).goToWorkarea( this.locations.get( locationIndex ), actors.get(i).getStatus() );
		}
		return;
	}
	
	private void displaySkyItems() {
		String[] DayOfWeek = {"MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"};
		DayTime clockMinutes = this.parent.getParent().getSimulator().getContextModel().getClockMinutes();
		int auditDay = this.parent.getParent().getSimulator().getContextModel().getAuditDay();
		int weekDay = this.parent.getParent().getSimulator().getContextModel().getWeekDay();
		double ambTemperature = this.parent.getParent().getSimulator().getContextModel().getAmbTemperature();
		
		// 
		for( int i = 0; i < this.workareaPanes.size(); i++ ) {
			this.workareaPanes.get(i).setLightLevel(clockMinutes);
		}
		
		// Set sky color

		
		if (this.dayNight) {		
			this.skyLeft.setVisible(false);
			this.skyTop.setVisible(false);
			this.skyRight.setVisible(false);
			this.skyBottom.setVisible(false);
			this.skyLeft.setBackground(		ColorLevel.getSkyColor( clockMinutes ));
			this.skyTop.setBackground(		ColorLevel.getSkyColor( clockMinutes ));
			this.skyRight.setBackground(	ColorLevel.getSkyColor( clockMinutes ));
			this.skyBottom.setBackground(	ColorLevel.getSkyColor( clockMinutes ));		
			this.skyLeft.setVisible(true);
			this.skyTop.setVisible(true);
			this.skyRight.setVisible(true);
			this.skyBottom.setVisible(true);
		}

		
		// Display variables
		this.clockLabel.setText( clockMinutes.getDayTimeString() );
		if (this.dayNight) { this.clockLabel.setForeground( ColorLevel.getDisplaySky( clockMinutes ) ); }
		this.weekDayLabel.setText(DayOfWeek[weekDay]);
		if (this.dayNight) { this.weekDayLabel.setForeground( ColorLevel.getDisplaySky( clockMinutes ) ); }
		this.auditDayLabel.setText( "Day " + auditDay );
		if (this.dayNight) { this.auditDayLabel.setForeground(ColorLevel.getDisplaySky( clockMinutes ) ); }
		this.ambTempLabel.setText( Weather.getAmbTempString( ambTemperature ) );
		if (this.dayNight) { this.ambTempLabel.setForeground( ColorLevel.getDisplaySky(clockMinutes) );  }
		this.weatherLabel.setText( "Clear" );
		if (this.dayNight) { this.weatherLabel.setForeground( ColorLevel.getDisplaySky(clockMinutes) ); }
		
		this.totalPowerLabel.setText( this.parent.getParent().getSimulator().getPlant().getCurrPowerString() );
		if (this.dayNight) { this.totalPowerLabel.setForeground( ColorLevel.getDisplaySky(clockMinutes)); }
		
		this.totalEnergyLabel.setText( this.parent.getParent().getSimulator().getPlant().getCumEnergyString() );
		if (this.dayNight) { this.totalEnergyLabel.setForeground( ColorLevel.getDisplaySky(clockMinutes)); }
		
		this.totalCostLabel.setText( this.parent.getParent().getSimulator().getPlant().getCumCostString() );
		if (this.dayNight) { this.totalCostLabel.setForeground( ColorLevel.getDisplaySky(clockMinutes)); }
		
		this.productEnergyLabel.setText( this.parent.getParent().getSimulator().getPlant().getProductEnergyString() );
		if (this.dayNight) { this.productEnergyLabel.setForeground( ColorLevel.getDisplaySky(clockMinutes)); }
		
		this.productCostLabel.setText( this.parent.getParent().getSimulator().getPlant().getProductCostString() );
		if (this.dayNight) { this.productCostLabel.setForeground( ColorLevel.getDisplaySky(clockMinutes)); }
		
		this.numberAccidentsLabel.setText( this.parent.getParent().getSimulator().getPlant().getNumberAccidentsString() );
		if (this.dayNight) { this.numberAccidentsLabel.setForeground( ColorLevel.getDisplaySky(clockMinutes)); }
	}
	
	// define and init components
		
	private void initComponents() {
		this.setLayout(null);
		// background image		
		JLabel backImageLabel = new JLabel();
		backImageLabel.setIcon( new javax.swing.ImageIcon("pics/PlantBackRaw.png") );
		backImageLabel.setLocation(0, 0);
		backImageLabel.setSize(backImageLabel.getIcon().getIconWidth(),backImageLabel.getIcon().getIconHeight());
        this.add(backImageLabel);
        
        this.exitButton = new JButton(  new javax.swing.ImageIcon("pics/Icon-Exit.png") );
        this.exitButton.setLocation(1363, 964);
        this.exitButton.setSize( this.exitButton.getIcon().getIconWidth(), this.exitButton.getIcon().getIconHeight());
        this.exitButton.addActionListener( this );
        backImageLabel.add( this.exitButton );
        //
        this.startButton = new JButton(  new javax.swing.ImageIcon("pics/Icon-Start.png") );
        this.startButton.setLocation( 76, 80);
        this.startButton.setSize( this.startButton.getIcon().getIconWidth(), this.startButton.getIcon().getIconHeight());
        this.startButton.addActionListener( this );
        backImageLabel.add( this.startButton );
        //
        this.resetButton = new JButton(  new javax.swing.ImageIcon("pics/Icon-Reset.png") );
        this.resetButton.setLocation( 76, 964);
        this.resetButton.setSize( this.resetButton.getIcon().getIconWidth(), this.resetButton.getIcon().getIconHeight());
        this.resetButton.addActionListener( this );
        backImageLabel.add( this.resetButton );
        //
        this.dayNightButton = new JButton(  new javax.swing.ImageIcon("pics/Icon-DayNight.png") );
        this.dayNightButton.setLocation( 1363, 80);
        this.dayNightButton.setSize( this.dayNightButton.getIcon().getIconWidth(), this.dayNightButton.getIcon().getIconHeight());
        this.dayNightButton.addActionListener( this );
        backImageLabel.add( this.dayNightButton );
        // setpoint rate slider
        this.setpointRateSlider = new JSlider( JSlider.VERTICAL, 0, 10, 5 );
        this.setpointRateSlider.setPaintTicks(true);
        this.setpointRateSlider.setPaintLabels(false);
        this.setpointRateSlider.setOpaque( false );
        this.setpointRateSlider.setMajorTickSpacing(2);
        this.setpointRateSlider.setBounds(32, 436, 44, 210);
        this.setpointRateSlider.addChangeListener( this );
        backImageLabel.add( this.setpointRateSlider );
        // sky panels
        this.skyLeft = new JPanel();
        this.skyLeft.setLayout(null);
        this.skyLeft.setBounds( 0, 0, Const.SKYLEFT_PANEL_WIDTH, Const.SKYLEFT_PANEL_HEIGHT );
        this.skyLeft.setBackground(ColorLevel.getSkyColor(0));
        backImageLabel.add(this.skyLeft);
        //
        this.skyTop = new JPanel();
        this.skyTop.setLayout(null);
        this.skyTop.setBounds( Const.SKYLEFT_PANEL_WIDTH, 0, Const.SKYTOP_PANEL_WIDTH, Const.SKYTOP_PANEL_HEIGHT );
        this.skyTop.setBackground(ColorLevel.getSkyColor(0));
        backImageLabel.add(this.skyTop);
        //
        this.skyRight = new JPanel();
        this.skyRight.setLayout(null);
        this.skyRight.setBounds( Const.SKYLEFT_PANEL_WIDTH + Const.SKYTOP_PANEL_WIDTH, 0, 
        		Const.SKYRIGHT_PANEL_WIDTH, Const.SKYRIGHT_PANEL_HEIGHT);
        this. skyRight.setBackground(ColorLevel.getSkyColor(0));
        backImageLabel.add(this.skyRight);
        //
        this.skyBottom = new JPanel();
        this.skyBottom.setLayout(null);
        this.skyBottom.setBounds( Const.SKYLEFT_PANEL_WIDTH, Const.SKYLEFT_PANEL_HEIGHT - Const.SKYBOTTOM_PANEL_HEIGHT, 
        		Const.SKYBOTTOM_PANEL_WIDTH, Const.SKYBOTTOM_PANEL_HEIGHT );
        this.skyBottom.setBackground(ColorLevel.getSkyColor(0));
        backImageLabel.add( this.skyBottom );
        //
        // Add workareaPanes (i.e. LayeredPane) to the backPanel
        for (int i = 0; i < this.workareaPanes.size(); i++) {
       		backImageLabel.add(this.workareaPanes.get(i));
        }
        // ---------
        // side display with clock
        this.clockLabel = new JLabel( "00:00", SwingConstants.CENTER);
        this.clockLabel.setBounds( 200, 10, 250, 60 );
        this.clockLabel.setOpaque( false );
        this.clockLabel.setForeground( ColorLevel.getDisplaySky( new DayTime( 0 ) ) );
        this.clockLabel.setFont( new Font( "Arial", Font.BOLD, Const.VIEW_FRAME_FONT_SIZE_HUGE ));
        this.skyRight.add( this.clockLabel );
        // side display with weekday
        this.weekDayLabel = new JLabel( "MONDAY", SwingConstants.CENTER );
        this.weekDayLabel.setBounds( 200, 70, 250, 40 );
        this.weekDayLabel.setOpaque( false );
        this.weekDayLabel.setForeground( ColorLevel.getDisplaySky(new DayTime(0)) );
        this.weekDayLabel.setFont( new Font( "Arial", Font.BOLD, Const.VIEW_FRAME_FONT_SIZE_MEDIUM ) );
        this.skyRight.add( this.weekDayLabel );
        // side display with audit day
        this.auditDayLabel = new JLabel( "Day 1", SwingConstants.CENTER );
        this.auditDayLabel.setBounds( 200, 150, 250, 40 );
        this.auditDayLabel.setOpaque( false );
        this.auditDayLabel.setForeground( ColorLevel.getDisplaySky( new DayTime(0) ) );
        this.auditDayLabel.setFont( new Font( "Arial", Font. BOLD, Const.VIEW_FRAME_FONT_SIZE_MEDIUM ) );
        this.skyRight.add( this.auditDayLabel );
        //
        // CONSUMPTION & COSTS DISPLAYS
        int y = 220;
        this.totalPowerLabel = new JLabel( "0.00 kW", SwingConstants.RIGHT );
        this.totalPowerLabel.setBounds( 40, y, Const.PLANT_PANEL_TOTAL_DISPLAY_WIDTH, Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT );
        this.totalPowerLabel.setOpaque( false );
        this. totalPowerLabel.setForeground( ColorLevel.getDisplaySky( new DayTime(0) ) );
        this.totalPowerLabel.setFont( new Font( "Arial", Font.PLAIN, Const.VIEW_FRAME_FONT_SIZE_LARGE ) );
        this.skyRight.add( this.totalPowerLabel );
        //
        y += Const.PLANT_PANEL_TOTAL_DISPLAY_GAP + Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT;
        this.totalEnergyLabel = new JLabel( "0.00 kWh", SwingConstants.RIGHT );
        this.totalEnergyLabel.setBounds( 40, y, Const.PLANT_PANEL_TOTAL_DISPLAY_WIDTH, Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT  );
        this.totalEnergyLabel.setOpaque( false );
        this.totalEnergyLabel.setForeground( ColorLevel.getDisplaySky( new DayTime( 0 ) ) );
        this.totalEnergyLabel.setFont( new Font( "Arial", Font.PLAIN, Const.VIEW_FRAME_FONT_SIZE_LARGE ) );
        this.skyRight.add( this.totalEnergyLabel );
        // --
        y += Const.PLANT_PANEL_TOTAL_DISPLAY_GAP + Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT;
        this.totalCostLabel = new JLabel( "0.00 \u20AC", SwingConstants.RIGHT );
        this.totalCostLabel.setBounds( 40, y, Const.PLANT_PANEL_TOTAL_DISPLAY_WIDTH, Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT  );
        this.totalCostLabel.setOpaque( false );
        this.totalCostLabel.setForeground( ColorLevel.getDisplaySky( new DayTime( 0 ) ) );
        this.totalCostLabel.setFont(new Font( "Arial", Font.PLAIN, Const.VIEW_FRAME_FONT_SIZE_LARGE ) );
        this.skyRight.add( this.totalCostLabel );
        //
        y += Const.PLANT_PANEL_TOTAL_DISPLAY_GAP + Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT;
        this.productEnergyLabel = new JLabel( "0.00 kWh/u", SwingConstants.RIGHT );
        this.productEnergyLabel.setBounds( 40, y, Const.PLANT_PANEL_TOTAL_DISPLAY_WIDTH, Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT  );
        this.productEnergyLabel.setOpaque( false );
        this.productEnergyLabel.setForeground( ColorLevel.getDisplaySky( new DayTime( 0 ) ) );
        this.productEnergyLabel.setFont(new Font("Arial",Font.PLAIN, Const.VIEW_FRAME_FONT_SIZE_LARGE ) );
        this.skyRight.add( this.productEnergyLabel );
        //
        y += Const.PLANT_PANEL_TOTAL_DISPLAY_GAP + Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT;
        this.productCostLabel = new JLabel("0.00 \u20AC/u", SwingConstants.RIGHT);
        this.productCostLabel.setBounds(40, y, Const.PLANT_PANEL_TOTAL_DISPLAY_WIDTH, Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT );
        this.productCostLabel.setOpaque(false);
        this.productCostLabel.setForeground( ColorLevel.getDisplaySky(new DayTime(0)) );
        this.productCostLabel.setFont(new Font("Arial",Font.PLAIN, Const.VIEW_FRAME_FONT_SIZE_LARGE ) );
        this.skyRight.add( this.productCostLabel );
        //
        y += Const.PLANT_PANEL_TOTAL_DISPLAY_GAP + Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT;
        this.numberAccidentsLabel = new JLabel("000 acc", SwingConstants.RIGHT);
        this.numberAccidentsLabel.setBounds(40, y, Const.PLANT_PANEL_TOTAL_DISPLAY_WIDTH, Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT );
        this.numberAccidentsLabel.setOpaque(false);
        this.numberAccidentsLabel.setForeground( ColorLevel.getDisplaySky(new DayTime(0)) );
        this.numberAccidentsLabel.setFont(new Font("Arial",Font.PLAIN, Const.VIEW_FRAME_FONT_SIZE_LARGE ) );
        this.skyRight.add( this.numberAccidentsLabel );
        
        // WEATHER DISPLAY
        this.ambTempLabel = new JLabel( "10 \u00BAC", SwingConstants.CENTER );
        this.ambTempLabel.setBounds( 5, 10, 250, Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT + 10 );
        this.ambTempLabel.setOpaque( false );
        this.ambTempLabel.setForeground( ColorLevel.getDisplaySky( new DayTime( 0 ) ) );
        this.ambTempLabel.setFont( new Font( "Arial", Font.BOLD, Const.VIEW_FRAME_FONT_SIZE_HUGE ) );
        this.skyRight.add( ambTempLabel );
        //
        this.weatherLabel = new JLabel( "Clear", SwingConstants.CENTER );
        this.weatherLabel.setBounds( 5, 70, 250, Const.PLANT_PANEL_TOTAL_DISPLAY_HEIGHT - 10);
        this.weatherLabel.setOpaque( false );
        this.weatherLabel.setForeground( ColorLevel.getDisplaySky( new DayTime(0) ) );
        this.weatherLabel.setFont( new Font( "Arial", Font.BOLD, Const.VIEW_FRAME_FONT_SIZE_MEDIUM ) );
        this.skyRight.add( this.weatherLabel );
        //
        this.logoLabel = new JLabel( new ImageIcon( Const.VIEW_LOGO_ICON ) );
        this.logoLabel.setBounds( 80, 870, 300, 100 );  
        this.skyRight.add( this.logoLabel );
		//
		return;
	}
	
	private void defineWorkareaPanes() {
		Vector<Workarea> workareas = this.parent.getParent().getSimulator().getPlant().getWorkareas();
		this.workareaPanes = new Vector<WorkareaPane>();
		for( int i = 0; i < workareas.size(); i++ ) {
			this.workareaPanes.add( new WorkareaPane( workareas.get(i).getId(), workareas.get(i).getSkyExposure() ) );
		}
		
		return;
	}
	
	private void defineUnitLabels() {
		Vector<Unit> units = this.parent.getParent().getSimulator().getPlant().getUnits();
		this.unitLabels = new Vector<UnitLabel>();
		for( int i = 0; i < units.size(); i++ ) {
			this.unitLabels.add( new UnitLabel( units.get(i).getId(), units.get(i).getType(), units.get(i).getParent().getStatus(), units.get(i).getWorkareaId()) );
			this.unitLabels.get(i).showUnit();
			this.getWorkareaPaneFromId( this.unitLabels.get(i).getWorkareaId() ).add( this.unitLabels.get(i),0 );
		}
		return;
	}
	
	private void defineLocations() {
		this.locations = new Vector<Location>();
		this.locations.add( 0, new Location( 225 ) );
		this.locations.add( 1, new Location( 000 ) );
		this.locations.add( 2, new Location( 000 ) );
		this.locations.add( 3, new Location( 245 ) );
		this.locations.add( 4, new Location( 000 ) );
		this.locations.add( 5, new Location( 000 ) );
		this.locations.add( 6, new Location( 265 ) );
		this.locations.add( 7, new Location( 000 ) );
		this.locations.add( 8, new Location( 000 ) );
		this.locations.add( 9, new Location( 285 ) );
		this.locations.add(10, new Location( 000 ) );
		this.locations.add(11, new Location( 000 ) );
		this.locations.add(12, new Location( 425 ) );
		this.locations.add(13, new Location( 000 ) );
		this.locations.add(14, new Location( 000 ) );
		this.locations.add(15, new Location( 445 ) );
		this.locations.add(16, new Location( 000 ) );
		this.locations.add(17, new Location( 000 ) );
		this.locations.add(18, new Location( 465 ) );
		this.locations.add(19, new Location( 000 ) );
		this.locations.add(20, new Location( 000 ) );
		this.locations.add(21, new Location( 485 ) );
		this.locations.add(22, new Location( 000 ) );
		this.locations.add(23, new Location( 000 ) );
		this.locations.add(24, new Location( 625 ) );
		this.locations.add(25, new Location( 000 ) );
		this.locations.add(26, new Location( 000 ) );
		this.locations.add(27, new Location( 645 ) );
		this.locations.add(28, new Location( 000 ) );
		this.locations.add(29, new Location( 000 ) );
		this.locations.add(30, new Location( 665 ) );
		this.locations.add(31, new Location( 000 ) );
		this.locations.add(32, new Location( 000 ) );
		this.locations.add(33, new Location( 685 ) );
		this.locations.add(34, new Location( 000 ) );
		this.locations.add(35, new Location( 000 ) );
		this.locations.add(36, new Location( 825 ) );
		this.locations.add(37, new Location( 000 ) );
		this.locations.add(38, new Location( 000 ) );
		this.locations.add(39, new Location( 845 ) );
		this.locations.add(40, new Location( 000 ) );
		this.locations.add(41, new Location( 000 ) );
		this.locations.add(42, new Location( 865 ) );
		this.locations.add(43, new Location( 000 ) );
		this.locations.add(44, new Location( 000 ) );
		this.locations.add(45, new Location( 885 ) );
		this.locations.add(46, new Location( 000 ) );
		this.locations.add(47, new Location( 000 ) );
		//
		for( int i = 0; i < this.locations.size(); i++ ) {
			int workareaPaneId = this.locations.get(i).getId()/10;
			this.locations.get(i).setWorkareaPane( this.getWorkareaPaneFromId( workareaPaneId ) );
		}
		return;
	}
	
	private void defineActorLabels() {
		Vector<Actor> actors = this.parent.getParent().getSimulator().getPlant().getActors();
		this.actorLabels = new Vector<ActorLabel>();
		for( int i = 0; i < actors.size(); i++ ) {
			this.actorLabels.add( new ActorLabel( actors.get(i).getId(), actors.get(i).getName() ) );	
		}
		return;
	}
	
	// gets&sets
	
	public WorkareaPane getWorkareaPaneFromId( int id ) {
		for( int i = 0; i < this.workareaPanes.size(); i++ ) {
			if ( this.workareaPanes.get(i).getId() == id ) return this.workareaPanes.get(i);
		}
		return null;
	}

	@Override
	public void stateChanged(ChangeEvent e) {
		if ( e.getSource() == this.setpointRateSlider ) {
			this.parent.getParent().getSimulator().getPlant().setSetPointRate( this.setpointRateSlider.getValue() / 10.0 );
		}
		return;
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		if ( e.getSource() == this.exitButton ) {
			this.parent.getParent().exitApplication();
		} else if( e.getSource() == startButton ) {
			if ( this.parent.getParent().getSimulator().isSimRunON() ) {
				this.parent.getParent().getSimulator().stopSimulation();
				this.parent.getParent().getStartButton().setText("Start");
			} else {
				this.parent.getParent().getSimulator().startSimulation();
				this.parent.getParent().getStartButton().setText("Stop");
			}
		} else if( e.getSource() == resetButton ) {
			
		} else if( e.getSource() == dayNightButton ) {
			this.dayNight = !this.dayNight;
		}
		return;
	}
	
}
