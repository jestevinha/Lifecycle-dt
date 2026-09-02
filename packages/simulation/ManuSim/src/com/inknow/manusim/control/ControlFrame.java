package com.inknow.manusim.control;

import java.awt.Font;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.IOException;
//
import javax.swing.JButton;
import javax.swing.JPanel;
import javax.swing.JSeparator;
import javax.swing.JTabbedPane;

import com.inknow.manusim.setup.SetupActors;
import com.inknow.manusim.setup.SetupSimulation;
import com.inknow.manusim.setup.SetupUnits;
import com.inknow.manusim.view.ViewFrame;

public class ControlFrame extends javax.swing.JFrame implements ActionListener {

	private JButton startButton;
	private JButton loadButton;
	private JButton saveButton;
	private JButton exitButton;
	//
	private JTabbedPane mainTabbedPane;
	// setup tabs
	private SetupSimulation setupSimulation;
	private SetupUnits setupUnits;	
	private SetupActors setupActors;
	//
	private Simulator simulator;
	private ViewFrame view;
	//
	private static final long serialVersionUID = 1L;

	// constructors

	public ControlFrame() {
		super();
		this.initComponents();
		this.setupSimulation = new SetupSimulation(this);
		this.setupUnits = new SetupUnits(this);
		this.setupActors = new SetupActors(this);
		//
		this.simulator = new Simulator (this);
		this.view = new ViewFrame( this );
		if ( Const.APP_DATABASE_ON ) {
			DBIO.resetDB();
			DBIO.insertActors( this.simulator.getPlant().getActors() );
			DBIO.insertTeams();
			DBIO.insertUnittypes();
			DBIO.insertWorkareas( this.simulator.getPlant().getWorkareas() );
		}
	}

	// other methods

	private void initComponents() {
		this.setDefaultCloseOperation(javax.swing.WindowConstants.EXIT_ON_CLOSE);
		this.setTitle( Const.CONTROL_FRAME_TITLE );
		this.setIconImage((new javax.swing.ImageIcon(Const.CONTROL_FRAME_ICON)).getImage());
		this.setBounds(Const.CONTROL_FRAME_X, Const.CONTROL_FRAME_Y, Const.CONTROL_FRAME_WIDTH, Const.CONTROL_FRAME_HEIGHT);
		//
		// west panel for buttons
		//
		JPanel buttonsPanel = new JPanel();
		buttonsPanel.setBorder(javax.swing.BorderFactory.createBevelBorder(javax.swing.border.BevelBorder.RAISED));
		buttonsPanel.setPreferredSize(new java.awt.Dimension(Const.BP_WIDTH, Const.BP_HEIGHT));
		buttonsPanel.setLayout(new java.awt.FlowLayout(java.awt.FlowLayout.CENTER, Const.BP_HGAP, Const.BP_VGAP));
		//
		startButton = new JButton("Start");
		startButton.setPreferredSize(new java.awt.Dimension(Const.BUTTON_WIDTH, Const.BUTTON_HEIGHT));
		startButton.setFont(new Font( Const.CONTROL_FRAME_FONT, Font.PLAIN, Const.CONTROL_FRAME_FONT_SIZE_NORMAL));
		startButton.addActionListener(this);
		buttonsPanel.add(startButton);
		//
		JSeparator auxSep = new JSeparator();
		auxSep.setPreferredSize(new java.awt.Dimension(Const.BUTTON_WIDTH, Const.BP_VGAP));
		buttonsPanel.add(auxSep);
		//
		loadButton = new JButton("Load");
		loadButton.setPreferredSize(new java.awt.Dimension(Const.BUTTON_WIDTH, Const.BUTTON_HEIGHT));
		loadButton.setFont(new Font( Const.CONTROL_FRAME_FONT, Font.PLAIN, Const.CONTROL_FRAME_FONT_SIZE_NORMAL));
		loadButton.addActionListener(this);
		buttonsPanel.add(loadButton);
		//
		saveButton = new JButton("Save");
		saveButton.setPreferredSize(new java.awt.Dimension(Const.BUTTON_WIDTH, Const.BUTTON_HEIGHT));
		saveButton.setFont(new Font( Const.CONTROL_FRAME_FONT, Font.PLAIN, Const.CONTROL_FRAME_FONT_SIZE_NORMAL));
		saveButton.addActionListener(this);
		buttonsPanel.add(saveButton);
		//
		auxSep = new JSeparator();
		auxSep.setPreferredSize(new java.awt.Dimension(Const.BUTTON_WIDTH, Const.BP_VGAP));
		buttonsPanel.add(auxSep);
		//
		exitButton = new JButton("Exit");
		exitButton.setPreferredSize(new java.awt.Dimension(Const.BUTTON_WIDTH, Const.BUTTON_HEIGHT));
		exitButton.setFont(new Font( Const.CONTROL_FRAME_FONT, Font.PLAIN, Const.CONTROL_FRAME_FONT_SIZE_NORMAL));
		exitButton.addActionListener(this);
		buttonsPanel.add(exitButton);
		//
		this.getContentPane().add(buttonsPanel, java.awt.BorderLayout.WEST);
		//
		// TABBED PANE - Simulator tabs
		//
		mainTabbedPane = new javax.swing.JTabbedPane();
		mainTabbedPane.setBorder(javax.swing.BorderFactory.createBevelBorder(javax.swing.border.BevelBorder.RAISED));
		mainTabbedPane.setFont(new Font( Const.CONTROL_FRAME_FONT, Font.PLAIN, Const.CONTROL_FRAME_FONT_SIZE_NORMAL)); 
		this.getContentPane().add(mainTabbedPane, java.awt.BorderLayout.CENTER);
	}

	// gets&sets
	
	public JButton getStartButton() {
		return this.startButton;
	}

	public ViewFrame getViewFrame() {
		return this.view;
	}

	public Simulator getSimulator() {
		return this.simulator;
	}

	public SetupSimulation getSetupSimulation() {
		return this.setupSimulation;
	}

	public SetupActors getSetupActors() {
		return this.setupActors;
	}

	public SetupUnits getSetupUnits() {
		return this.setupUnits;
	}

	public JTabbedPane getMainTabbedPane() {
		return this.mainTabbedPane;
	}
	
	public void loadSetup() {
		int[] x = FileIO.loadSetupFile("data/setup.dat", Const.N_UNIT_TYPES * 6 + Const.N_ACTOR_TYPES + 4 );
        int j = 0;            
        for(int i = 0; i < this.setupUnits.getUnitAPowerRateModels().size(); i++, j++) {
        	this.setupUnits.getUnitAPowerRateModels().set(i, this.setupUnits.getPowerRateStdModels().get( this.setupUnits.getPowerRateStdModelIndexById( x[j] ) ) );
        	this.setupUnits.getPowerRateButton().get(i).setIcon( new javax.swing.ImageIcon( this.setupUnits.getUnitAPowerRateModels().get(i).getPlotFilename() ) );
        }
        for(int i = 0; i < this.setupUnits.getUnitAefficiencyRawModels().size(); i++, j++) {
        	this.setupUnits.getUnitAefficiencyRawModels().set(i, this.setupUnits.getConcaveStdModels().get( this.setupUnits.getConcaveStdModelIndexById( x[j] ) ) );
        	this.setupUnits.getEfficiencyRawButton().get(i).setIcon( new javax.swing.ImageIcon( this.setupUnits.getUnitAefficiencyRawModels().get(i).getPlotFilename() ) );
        }
        for(int i = 0; i < this.setupUnits.getUnitCefficiencyTemperatureModels().size(); i++, j++) {
        	this.setupUnits.getUnitCefficiencyTemperatureModels().set(i, this.setupUnits.getConcaveStdModels().get( this.setupUnits.getConcaveStdModelIndexById( x[j] ) ) );
        	this.setupUnits.getEfficiencyTemperatureButton().get(i).setIcon( new javax.swing.ImageIcon( this.setupUnits.getUnitCefficiencyTemperatureModels().get(i).getPlotFilename() ) );
        }
        for(int i = 0; i < this.setupUnits.getUnitCwearRawModels().size(); i++, j++) {
        	this.setupUnits.getUnitCwearRawModels().set(i, this.setupUnits.getConvexStdModels().get( this.setupUnits.getConvexStdModelIndexById( x[j] ) ) );
        	this.setupUnits.getWearRawButton().get(i).setIcon( new javax.swing.ImageIcon( this.setupUnits.getUnitCwearRawModels().get(i).getPlotFilename() ) );
        }
        for(int i = 0; i < this.setupUnits.getUnitBefficiencyExpertiseModels().size(); i++, j++) {
        	this.setupUnits.getUnitBefficiencyExpertiseModels().set(i, this.setupUnits.getExponentialUpStdModels().get( this.setupUnits.getExponentialUpStdModelIndexById( x[j] ) ) );
        	this.setupUnits.getEfficiencyExpertiseButton().get(i).setIcon( new javax.swing.ImageIcon( this.setupUnits.getUnitBefficiencyExpertiseModels().get(i).getPlotFilename() ) );
        }
        for(int i = 0; i < this.setupUnits.getUnitCwearExpertiseModels().size(); i++, j++) {
        	this.setupUnits.getUnitCwearExpertiseModels().set(i, this.setupUnits.getExponentialDwnStdModels().get( this.setupUnits.getExponentialDwnStdModelIndexById( x[j] ) ) );
        	this.setupUnits.getWearExpertiseButton().get(i).setIcon( new javax.swing.ImageIcon( this.setupUnits.getUnitCwearExpertiseModels().get(i).getPlotFilename() ) );
        }
        for(int i = 0; i < this.setupActors.getActorsExpertModels().size(); i++, j++) {
        	this.setupActors.getActorsExpertModels().set(i, this.setupActors.getExpertiseStdModels().get( this.setupActors.getExpertiseModelIndexById( x[j] ) ) );
        }
        this.setupActors.setExpertBarLabels();
        //        
        this.setupActors.setActorSafetyExpertiseModel( this.setupActors.getExponentialUpStdModels().get( this.setupActors.getExponentialUpStdModelIndexById( x[j] ) ) );
        this.setupActors.getSafetyExpertiseButton().setIcon( new javax.swing.ImageIcon( this.setupActors.getActorSafetyExpertiseModel().getPlotFilename() ) );
        j++;
        this.setupActors.setActorSafetyLightModel( this.setupActors.getExponentialUpStdModels().get( this.setupActors.getExponentialUpStdModelIndexById( x[j] ) ) );
        this.setupActors.getSafetyLightButton().setIcon( new javax.swing.ImageIcon( this.setupActors.getActorSafetyLightModel().getPlotFilename() ) );
        j++;
        this.setupActors.setActorSafetyShifttimeModel( this.setupActors.getExponentialDecayStdModels().get( this.setupActors.getExponentialDecayStdModelIndexById( x[j] ) ) );
        this.setupActors.getSafetyShifttimeButton().setIcon( new javax.swing.ImageIcon( this.setupActors.getActorSafetyShifttimeModel().getPlotFilename() ) );
        j++;
        this.setupActors.setActorSafetyRateModel( this.setupActors.getExponentialDecayStdModels().get( this.setupActors.getExponentialDecayStdModelIndexById( x[j] ) ) );
        this.setupActors.getSafetyRateButton().setIcon( new javax.swing.ImageIcon( this.setupActors.getActorSafetyRateModel().getPlotFilename() ) );
        j++;
        this.simulator.getPlant().updateUnitsCurveModels();
        this.simulator.getPlant().updateExpertiseModels();
	}
	
	public void saveSetup() {
        int[] x = new int[ Const.N_UNIT_TYPES * 6 + Const.N_ACTOR_TYPES + 4 ];
        
        int j = 0;
        for(int i = 0; i < this.setupUnits.getUnitAPowerRateModels().size(); i++, j++) {
        	x[j] = this.setupUnits.getUnitAPowerRateModels().get(i).getId();
        }
        for(int i = 0; i <  this.setupUnits.getUnitAefficiencyRawModels().size(); i++, j++) {
        	x[j] = this.setupUnits.getUnitAefficiencyRawModels().get(i).getId();
        }
        for(int i = 0; i <  this.setupUnits.getUnitCefficiencyTemperatureModels().size(); i++, j++) {
        	x[j] = this.setupUnits.getUnitCefficiencyTemperatureModels().get(i).getId();
        }
        for(int i = 0; i <  this.setupUnits.getUnitCwearRawModels().size(); i++, j++) {
        	x[j] = this.setupUnits.getUnitCwearRawModels().get(i).getId();
        }
        
        for(int i = 0; i <  this.setupUnits.getUnitBefficiencyExpertiseModels().size(); i++, j++) {
        	x[j] = this.setupUnits.getUnitBefficiencyExpertiseModels().get(i).getId();
        }
        
        for(int i = 0; i <  this.setupUnits.getUnitCwearExpertiseModels().size(); i++, j++) {
        	x[j] = this.setupUnits.getUnitCwearExpertiseModels().get(i).getId();
        }
        for(int i = 0; i < this.setupActors.getActorsExpertModels().size(); i++, j++) {
        	x[j] = this.setupActors.getActorsExpertModels().get(i).getId();
        }         
        x[j] = this.setupActors.getActorSafetyExpertiseModel().getId();
        j++;
        x[j] = this.setupActors.getActorSafetyLightModel().getId();
        j++;
        x[j] = this.setupActors.getActorSafetyShifttimeModel().getId();
        j++;
        x[j] = this.setupActors.getActorSafetyRateModel().getId();
        j++;
        try {
        	FileIO.saveSetupFile( x, "data/setup.dat");
        } catch (IOException e) {
        	e.printStackTrace();
        }
	}
	
	public void exitApplication() {
		System.exit(0);
	}
	
	// listeners

	@Override
	public void actionPerformed(ActionEvent e) {
		if (e.getSource() == exitButton) {
			this.exitApplication();
		} else if(e.getSource() == startButton) {
			if (this.simulator.isSimRunON()) {
				this.simulator.stopSimulation();
				this.startButton.setText("Start");
			} else {
				this.simulator.startSimulation();
				this.startButton.setText("Stop");
			}	
		} else if (e.getSource() == loadButton) {
        	this.loadSetup();        	
    	} else if (e.getSource() == saveButton) {
        	this.saveSetup();       	
        }	
	}
}
